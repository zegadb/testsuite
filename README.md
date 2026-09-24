# ZQL conformance

A readable contract for [Zega](https://github.com/zegadb/zega): one corpus, three hosts. **native** calls the Rust crate directly, **browser** runs the same adapter as WASM in Chromium, and **server** sends each case over HTTP to `zega start` (the `zega-server` routes) built from the same pinned revision. Case metadata still names the two engine adapters; the server host runs every executable document.

## Reproduce

Requires Rust, Node.js 24 or later, and npm. The engine is a public Git dependency pinned in `Cargo.toml`, `Cargo.lock`, and `engine.json`; no local engine checkout or credentials are needed.

```sh
npm ci
mkdir -p .tmp
chmod 700 .tmp
export CARGO_TARGET_DIR="$PWD/.target" TMPDIR="$PWD/.tmp"
cargo build --locked --bin zql-native
npm test -- --host native
npm test -- --host native --case tests/import/json_array
npm test -- --host native --filter query/ --reverse
npm run test:runner
```

The corpus uses the canonical [APS 12 formatter](https://github.com/zegadb/aps/issues/12).
With the pinned engine's CLI available, run `node scripts/format.mjs /path/to/zega`
to format cases and JSON fixtures or append `--check` to check them without writing. This invokes
`zega fmt` on the empty `.zql` markers **and the executable `.code` files**.
Parse-error fixtures remain byte-for-byte unchanged. After formatting inputs,
`node scripts/check-diagnostic-locations.mjs <base-revision>` proves expected
stdout, outcome markers, diagnostic messages and highlighted tokens are unchanged;
only source locations and their surrounding excerpts may move.

The default run is offline and explicitly skips the remote import. `--online` enables that case. A failed network preflight skips an unreachable remote fixture; an HTTP error or engine failure after successful preflight fails the run. Local imports run offline. Filtering to no cases, or only skipped cases, exits 2.

Exit codes: **0** all executed expectations matched (possibly explicit SKIP/XFAIL), **1** assertion failure or unexpected success of a marked engine bug, **2** malformed corpus or unavailable/broken infrastructure. A crash is never accepted as an expected language error. Full reports are written to `.cache/<host>.json`, filtered reports to `.cache/<host>-selection.json`; `--report` chooses another path. `--help` lists all options.

## Fixture decision: each directory owns its graph

Every executable case starts with its own `schema`, optional `unique`, setup mutations, and final query or rejecting statement. The adapter creates a fresh `Zega::in_memory()` database per case. Local import files live in that directory, which is the native process's working directory. No shared or category fixture, no setup inherited from other cases, and no engine source modifications.

Small repeated schemas are intentional. A reader can copy one folder, inspect the whole setup, and run it with `--case /absolute/path/to/folder`. Changing a fixture cannot silently redefine unrelated assertions. The two syntax-only API cases identify `api: "query"` or `"statement"`; their invalid inputs are rejected before any graph exists.

```text
tests/<category>/<name>/
  <name>.code                  canonical ZQL source, including setup
  <name>.json                  title, stage, hosts, notes; optional api/network
  <name>.pass.zql              empty outcome marker (or .fail.zql)
  <name>.stdout                exact expected result bytes, including newline
  <name>.stderr                exact diagnostic bytes (empty on success)
  people.json / people.csv     optional case-local import data
```

This follows [Deka's directory-per-case corpus](https://github.com/dekaruntime/testsuite), with a ZQL extension and one canonical source file. The outcome marker is deliberately empty rather than a second copy of the source. `stage` is `parse` or `run`; `hosts` must always be exactly `["native", "browser"]`. Invalid metadata fails closed. Every case explains what it asserts in `notes`.

The final statement's JSON result is serialized by the shared Rust adapter, followed by one newline. Object keys are sorted by serde_json; arrays retain engine order. There is no whitespace trimming, field stripping, array sorting, host-specific expected output, or substring diagnostic matching. Failures compare the full rendered diagnostic: text, line/column, source excerpt, underline, help and newline. Earlier setup statements must all succeed. See [DIAGNOSTICS.md](DIAGNOSTICS.md) for the parser audit.

A known engine bug may carry `knownFailure: { reason, observed: { ok, stage, stdout, stderr } }`. The normal expected files describe the desired contract. XFAIL requires the exact recorded deviation; any other deviation is FAIL, and a fix becomes XPASS (exit 1) until reviewed. Never use a broad skip to hide an engine failure.

## Browser host

The same adapter compiles to WASM against the same locked engine dependency. It runs in a real Chromium Web Worker, not Node WASM. Each case gets a new worker and database. Case-local fixtures are served beside the worker so relative paths resolve without changing source. The worker fetches raw text asynchronously and supplies it to the engine's `apply_zql_with_sources` API; Rust parses and inserts all JSON/CSV rows. Locations and import policy are checked by the engine before fetching.

```sh
rustup target add wasm32-unknown-unknown
# Match the version in Cargo.lock (currently 0.2.128).
cargo install wasm-bindgen-cli --version 0.2.128 --locked
node scripts/build-browser.mjs
npx playwright install chromium
npm test -- --host browser
node scripts/compare-hosts.mjs
```

Pass `--bindgen /path/to/wasm-bindgen` to use an existing matching tool. Missing Chromium, WASM or tooling is a blocking error, never an implicit native fallback. Parity compares complete native/browser outcomes and requires fresh full-corpus reports; skipped remote cases do not count as parity evidence.

## Server host

The server host proves the HTTP server that ships to deployments returns exactly what the engine returns. It uses the pinned revision's `zega` CLI, installed with a receipt so the runner can refuse a binary from any other revision:

```sh
cargo install --locked --git https://github.com/zegadb/zega.git --rev "$(node -p 'require("./engine.json").revision')" zega-cli --bin zega --root "$PWD/.tmp/tools"
npm test -- --host server          # or --zega /path/to/bin/zega (same --root receipt required)
node scripts/compare-hosts.mjs     # native/browser, native/server, browser/server
```

Each case gets its own `zega start --port 0` process, an empty persistent data directory, a generated bearer token and the case directory as working directory (so relative imports resolve like native). The runner checks that a request without the token is refused, then sends `POST /zql {"query": <source>, "document": true}`, which is `apply_zql` behind HTTP. A success body's `result` bytes are sliced out verbatim (never re-serialized by JavaScript) and compared byte-for-byte. The HTTP error body carries the engine's `ZegaError` text and no stage, so a failure takes the stage its case declares, and a parse-stage message must be exactly `execution error: ` followed by the native diagnostic. The two parser-only API cases (`api: query` / `statement`) have no HTTP entry point; they are reported as unsupported on the server and listed by `compare-hosts`, never counted as parity. Any unsupported *document* is a divergence.

### Stress

`node scripts/server-stress.mjs` runs the same release `zega` against six checks and writes one JSON line per result to stdout and `.cache/server-stress.jsonl`:

- **concurrency**: 16 clients, 2 minutes (`--duration`). The checks are no torn or stale reads, and final nodes equal acknowledged writes.
- **durability**: 3× kill -9 during write load. Each write is one statement: a parent plus 3 linked children. Every acknowledged write must be whole after restart, and in-flight ones must be whole or absent.
- **growth / timings**: 100k nodes (`--nodes`) with 300k relationships, RSS at 10k/50k/100k, `GET /graph` time and peak RSS, restart time to the first answered query, and p50/p99 for reads, writes and a 2-hop traversal.
- **bad-input**: malformed JSON or ZQL, wrong types, a missing token, an oversized body. Good clients must see zero errors, and their latency is compared with a baseline.
- **nesting**: recursion depth that a client controls.

Exit 1 on any failed check. `--only <names>` selects a subset. The stress run is local evidence, not a CI step: it takes minutes and its timings depend on the machine.

## Browse the corpus

```sh
npm run build
npm run preview
# http://127.0.0.1:4173
npm run check:site
```

Next.js statically exports every case, source, local fixture, exact expectation, and assertion notes to `out/`. Search and category filters work in the browser. Downloadable `corpus.json` and `results.json` are included. Results are recorded, not live; absent, partial or stale reports are shown as **NOT RUN**, never green. Corpus digests prevent stale results from being attached to changed expectations.

The site uses Next.js [`output: 'export'`](https://nextjs.org/docs/app/guides/static-exports). `wrangler.jsonc` configures [Cloudflare Worker static assets](https://developers.cloudflare.com/workers/static-assets/) from `out/`. No deploy command or workflow runs automatically. Ava attaches `testsuite.zega.dev` later.

CI on push and pull request uses `environment: public-ci`, public dependencies, no repository secrets, and required sccache. It runs native conformance, HTTP server conformance, runner fault injection, reverse order, Chromium/WASM conformance, pairwise parity across all three hosts, static build and Chromium site checks, then uploads the site and every host report. The remote import is explicitly skipped offline in CI.

## Add or update a case

Author a self-contained source and an independent expected result. Include positive boundary controls as well as rejected inputs. Do not generate success expectations from the engine under test. For diagnostics, review the intended rejection and pin its complete rendered text. Run the case, full native corpus, reverse order, runner checks, and the site build. Run both hosts when changing shared serialization or host adapters. Never regenerate all expectations to make a failure disappear.

## Vector coverage

`tests/vector/` covers fixed dimensions, numeric components, metric validation,
explicit JSON/CSV loading, automatic nearest ordering, exact filtered search,
similarity thresholds, updates, relationship-scoped nearest selection and both
explicit vector view declarations. It also covers optional vectors in nearest
selection, the `near`/`order` diagnostic, `near` with `limit`, and nested
results containing incompatible vector dimensions and metrics. Success
expectations are independently specified; rejecting cases pin the complete
reviewed diagnostic and source span.
The engine revision is recorded in `engine.json`. Engine recall/PCA and headless explorer checks live with that
implementation; this corpus exercises the shared ZQL contract on both hosts.

## Index coverage

`tests/index/` covers the `index { range … text … }` block: two bounds on one
range-indexed field, equality, `||`, Float `-0.0`, String ordering, number and
string bounds together, all three text operators, a needle shorter than a
trigram, index maintenance through `set`, and `index` before `unique`. Every
success case has the same answer a scan gives; the corpus checks answers, and
the engine's own tests show the index is used (`Zega::rows_examined`).
Rejecting cases pin the checker's diagnostics: unknown type or field,
relationship, `text` on a non-String field, `range` on a Bool, a field named
twice, `range` on a unique field, an unknown kind and a second block.

## Path coverage

`tests/path/` covers `*path` route queries: fewest edges, `by &km` (Dijkstra)
and `by &km toward at` (A*, with the weight's unit declared in the schema as
`km: Float<km>`) on one road net, where the cheapest route has more edges than
the direct one. It also covers Dijkstra on a plain `Float` weight, an
unreachable target (null), inclusive and exclusive cost bounds, a hop bound, a
target condition matching several nodes, a start that is its own target, and a
tie broken by node id with an Int weight. Success expectations were written by
hand from the road lengths, not taken from the engine. Rejecting cases pin the
diagnostics for a missing weight, a negative weight, kilometres stored in a
`Float<m>` field under A*, `toward` without a weight, `toward` on a weight
with no unit, a start type without the `toward` Point, a weight that is not a
number, a hop bound on a weighted path, an unknown unit, a unit on a `String`, two sides of one relationship declaring different units,
and a unit written in the query. The engine's own tests compare all three
searches with brute force on random graphs and show A* expands fewer nodes
(`Zega::nodes_expanded`).

## Names (APS 6)

`tests/names/` rejects every removed spelling and verifies stored `hops`, `cost`,
`shape`, `id`, and `score` independently of language-owned `@` names. It also
checks an edge field named `cost` as a path weight alongside an `@cost` bound.
The engine and browser package are pinned to the same engine revision in
`engine.json`; see [APS 6](https://github.com/zegadb/aps/issues/6).

## Node appearance and URL fields (APS 8)

`tests/node_shapes/` covers per-type `@shape`, `@image`, and `@size` display
attributes, defaults, whitespace-separated type entries, URL writes and
updates, optional URLs, JSON imports, and String filters/indexes. Rejections
pin the complete diagnostic, including the attribute/value span and the
`String<url>` fix for image fields. Both hosts use the same engine and URL
parser. URLs require HTTP(S), a host and no userinfo; scheme matching is
case-insensitive. Renderer geometry, image loading, keyboard preview, focus, zoom and
screenshots are tested with Playwright in the engine repository.

## Discovery stages (APS 7)

`tests/then/` specifies text discovery (including infix compatibility), regex,
common-value stars, vector similarity, spatial pairs, boolean precedence,
intersection edge pruning, union deduplication, stage chaining and skipped
responses. Full stage and evidence arrays have independent expected values;
array order is part of the contract. Rejections cover misplaced blocks, missing
fields, wrong types, unsupported regex and invalid units. Engine behavior and
implementation choices are documented in `docs/then.md` at the pinned revision.
