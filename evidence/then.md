# APS 7 part 1 validation

Engine pin in Cargo.toml, Cargo.lock and engine.json:
`ceeb32676807097479c15ed205c74617111dbce6`.
Its bundled browser WASM was rebuilt from clean engine source
`5c26340e5624228debd7930c40af37436e8455cc`.

The 38 new `tests/then/` cases contain 24 successes with independently authored
complete JSON expectations and 14 rejections with reviewed complete diagnostics.
They cover every discovery primitive, indexed text, infix compatibility, Unicode,
cross-type grouping, linear fan-out, boolean precedence, edge pruning and
deduplication, chaining, skip, previous-stage scope and type/syntax errors.

All commands exited 0:

- `cargo build --locked --bin zql-native` against the Git pin.
- `cargo check --locked --workspace --all-targets`.
- `cargo clippy --locked --workspace --all-targets --all-features`: zero warnings.
- `cargo test --locked --workspace`: the Rust adapter has no unit tests; its
  behavior is exercised by the corpus and runner fault-injection tests below.
- `npm test -- --host native --online`: 264 passed, zero failures/skips.
- `npm test -- --host native --reverse --online --report .cache/native-reverse.json`:
  264 passed, zero failures/skips.
- `node scripts/build-browser.mjs`: browser worker adapter built against the same Git pin.
- `npm test -- --host browser --online`: 264 passed, zero failures/skips.
- `node scripts/compare-hosts.mjs`: 264 identical outcomes, zero divergences/skips.
- `npm run test:runner`: four passed, including corrupted result/diagnostic bytes,
  changed stage/outcome, broken infrastructure, and exact known-failure matching.

Engine validation: the full workspace run passed 910 tests with two existing
large benchmark tests ignored. The final focused run passed 17 integration and
six discovery unit tests, including four integration tests added during the full
run. All 23 explorer Playwright tests passed, including three new pipeline tests.
The browser package passed 44 syntax/hash checks. Native workspace clippy had zero
warnings. The WASM build retains existing native-only WAL dead-code warnings.

Two engine mutation proofs were applied individually and restored:

1. Replaced `&&` node intersection with union. The intersection/edge-pruning
   integration test failed with exit 101 on the returned node IDs.
2. Disabled query-stage skip suppression. The skip/chaining integration test
   failed with exit 101 on the number of serialized stages.

After restoration, all focused tests passed. No success expectation was generated
from the engine's output. The implementation choices and result contract are in
[docs/then.md at the pin](https://github.com/zegadb/zega/blob/ceeb32676807097479c15ed205c74617111dbce6/docs/then.md).

Local logs and full native/browser reports are retained in the worktrees' `.tmp/`
and the testsuite's `.cache/`. CI was not polled.

-codex
