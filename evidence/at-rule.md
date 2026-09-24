# APS 6 validation

Engine Git pin: `aad94b06efe004695e59bbce0ea8cc14ddf9bfd9` in Cargo.toml,
Cargo.lock and engine.json. Its explorer WASM records the final engine source
commit `5107324e0bc2d472bfea7bbf88a9466c0b7c3b27`.

- `cargo check --locked --workspace --all-targets`: exit 0.
- `cargo clippy --locked --workspace --all-targets --all-features`: exit 0, no warnings.
- `cargo build --locked --bin zql-native`: exit 0.
- `npm test -- --host native --online`: 226 passed, 0 failed, 0 skipped.
- `npm test -- --host native --reverse --online --report .cache/native-reverse.json`: 226 passed, 0 failed, 0 skipped.
- `node scripts/build-browser.mjs`: exit 0; adapter compiled against the Git pin.
- `npm test -- --host browser --online`: 226 passed, 0 failed, 0 skipped.
- `node scripts/compare-hosts.mjs`: 226 identical outcomes, 0 divergences, 0 skipped.
- `npm run test:runner`: 4 passed.
- `npm run build` and `npm run check:site`: 226 case routes; search, navigation, filtering, mobile layout and console checks passed.

There are 19 new cases and one relocated existing rejection: `tests/names/`
has 16 failures and four successes. Removed-spelling grep over the remainder
of the corpus is empty. The namespace cases intentionally contain old spellings
and declared user fields with the same names.

The engine PR's `user_field_named_hops_is_stored_and_read` was also run against
the original parser/executor from `5cf1c8df7de715b63bb6d11fd26fc30983369236`:
it failed while writing the declared edge property (exit 101). Restoring the
fix made the test pass (exit 0).
