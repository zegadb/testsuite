Fixture decision: **every case owns its entire graph**. Each directory contains a complete schema, setup mutations, final query or rejecting statement, and any local import files. The runner creates a fresh in-memory Zega database for each case; native runs with that directory as its working directory, and browser runs in a new worker with fixtures served beside it. The two syntax-only parser API cases reject their input before any graph exists. A copied case directory is independently runnable. Reverse-order execution is green.

This deliberately repeats small schemas instead of sharing a global or category fixture. The cost is a little source duplication; the benefit is that every assertion is understandable in its own directory, fixture edits have a bounded effect, and there is no execution-order dependency. `.code` is the single canonical source. Empty `.pass.zql` / `.fail.zql` files encode the expected outcome without duplicating source; `.stdout` and `.stderr` pin exact bytes.

## Location and branch

- Checkout: `/Volumes/Projects/codex/zega-testsuite`
- Branch: `codex/testsuite`
- Remote: `git@github.com:zegadb/testsuite.git` (verified public)
- Engine: `zegadb/zega@718349d94673552f848d1abd7046a98496a5747a`, locked Git dependencies; no engine checkout was modified.
- The remote was genuinely empty: no commits and no default branch ref. This branch starts its history. No `main` was created or pushed, and there is no base branch against which to open a PR yet. Ava owns establishing/merging the default branch and deploying.
- Commits use the existing signed `Sami Fouad <sfouad@gmail.com>` identity with no agent trailers.

## Delivered

133 independent cases across seven categories: schema 15, query 15, filter 18, mutation 8, import 12, constraints 8, errors 57. They include union types/selections, outgoing and incoming traversal, nesting, hop ranges and `&hops`, comparisons and boolean precedence, string predicates, create/link/set, edge properties, local JSON/CSV imports, independent unique constraints, and parser/semantic/runtime diagnostics. There are 76 exact rejection assertions. All successful outputs were authored from the intended result; diagnostic recordings were accepted only after verifying the intended message and failure stage, then pinned in full.

[`DIAGNOSTICS.md`](DIAGNOSTICS.md) maps the reachable parser message families to cases and explicitly explains defensive unreachable branches (`expected json`, guarded `expected <-`, and unreachable numeric fallback arms). It does not claim exhaustive OS/network or internal-corruption diagnostics. No observed engine bug is suppressed: zero XFAILs. Strict known-failure support is implemented and tested; an engine fix becomes XPASS and fails until reviewed.

Metadata allows exactly `hosts: ["native", "browser"]`. Native invokes `Zega::apply_zql` directly; HTTP serving through `zega start` is not a third host. Both hosts compile the same small Rust adapter against the same locked engine and compare the same outcomes. JSON keys are deterministic, array order is preserved, and diagnostic matching includes source spans, underlines and help text.

## Real execution evidence

Full logs are committed under [`evidence/`](evidence/). Default offline run:

```text
native: 132 passed, 0 failed, 0 known failures, 0 unexpected passes, 1 skipped; 133 total
browser: 132 passed, 0 failed, 0 known failures, 0 unexpected passes, 1 skipped; 133 total
Parity: 132 identical outcomes, 0 divergences, 1 skipped on both hosts
```

The only skipped case is the immutable public remote import. It also ran separately with `--online`, through the actual engine loader, on both hosts:

```text
PASS  import/remote_url
native: 1 passed, 0 failed, 0 known failures, 0 unexpected passes, 0 skipped; 1 total
PASS  import/remote_url
browser: 1 passed, 0 failed, 0 known failures, 0 unexpected passes, 0 skipped; 1 total
```

Native reverse order: `132 passed, 0 failed, 1 skipped`. The runner's relocation test copies the local JSON-import case into an unrelated directory and runs it successfully there. No test relies on a previous case.

Deliberately changed `tests/query/selected_fields/selected_fields.stdout` from Ada to WRONG. Actual output, captured in [`evidence/wrong-expectation.txt`](evidence/wrong-expectation.txt):

```text
FAIL  query/selected_fields
  stdout expected: "{\"name\":\"WRONG\"}\n"
  stdout actual:   "{\"name\":\"Ada\"}\n"
native: 0 passed, 1 failed, 0 known failures, 0 unexpected passes, 0 skipped; 1 total
exit=1

Restored selected_fields.stdout:
PASS  query/selected_fields
native: 1 passed, 0 failed, 0 known failures, 0 unexpected passes, 0 skipped; 1 total
exit=0
```

The expectation was restored, and the complete native and browser corpora passed afterward. Four runner integration checks also prove byte mismatch, diagnostic mismatch, wrong stage/outcome, missing expectations, invalid hosts, missing adapters, empty selections, all-skipped selections, and strict XFAIL/XPASS behavior.

Rust checks passed: `cargo fmt --all -- --check`, `cargo check --locked --workspace --all-targets`, and `cargo clippy --locked --workspace --all-targets --all-features -- -D warnings` (zero warnings). `actionlint .github/workflows/ci.yml` passed.

## Run native or browser

```sh
cd /Volumes/Projects/codex/zega-testsuite
npm ci
mkdir -p .tmp
chmod 700 .tmp
export CARGO_TARGET_DIR="$PWD/.target" TMPDIR="$PWD/.tmp"
cargo build --locked --bin zql-native
npm test -- --host native
npm test -- --host native --case tests/import/json_array
```

Browser is implemented and was run in Chromium, not just left as an interface:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.128 --locked
node scripts/build-browser.mjs
npx playwright install chromium
npm test -- --host browser
node scripts/compare-hosts.mjs
```

On this checkout the downloaded matching tool is already at `.tmp/wasm-bindgen-0.2.128-x86_64-apple-darwin/wasm-bindgen`; pass its absolute path via `--bindgen` to the build script to avoid a global install. Browser import files use the engine's synchronous XHR in a Web Worker. Missing WASM/Chromium is a blocking error, never silently substituted with native. Both hosts accept `--online` to include the remote URL case.

## Site and CI

The Next.js app exports static HTML for every case to `out/`. It includes search, category filters, source/setup, local data files, exact stdout/diagnostics, both recorded host statuses, and downloadable corpus/results JSON. A corpus digest prevents stale or partial reports from displaying as current results. No result report means NOT RUN, never a fabricated pass.

```text
✓ Generating static pages using 5 workers (136/136)
Static site: 133 case routes + corpus JSON served; search, navigation, category filter, mobile layout and browser console passed
```

```sh
npm run build
npm run preview
# http://127.0.0.1:4173
npm run check:site
```

Desktop, mobile, and case-page screenshots were visually inspected and remain in `.tmp/site-*.png`. `wrangler.jsonc` points Cloudflare Worker static assets at `out/`. **Nothing was deployed.** Ava attaches `testsuite.zega.dev` and handles deployment.

The push/PR workflow uses `environment: public-ci`, public HTTPS dependencies, no repository secrets, and job-level required sccache. It runs native, runner fault injection, reverse order, browser/WASM, host parity, static build, and site QA, then uploads the site and reports. CI has not been polled; Ava owns watching the pushed workflow. No environment or credential was created or changed.

## Workspace note

During setup, 129 additional hyphen-named case directories appeared in this checkout, with metadata advertising an unwanted third `http` host. Their origin was not established. They were preserved, not deleted, under `.tmp/concurrent-files/tests/` and excluded from this branch. The committed corpus is the independently authored 133-case suite described above. No other checkout or branch was changed.

-codex
