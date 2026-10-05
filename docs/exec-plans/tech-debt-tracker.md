# Tech debt tracker

| Item | Why it is debt | Retire when |
|---|---|---|
| No ESLint (decision 0007) | Generic lint rules (unused vars, etc.) are not run; type-aware foot-guns are now covered by `two-track-check` (decision 0010) | typescript-eslint supports TS ≥ 7.1; then publish the checker's rules as a plugin too |
| `two-track-check` detects Result types structurally | A user type that happens to be `{ ok: boolean-literal; … }` is treated as a Result (false positive); a `Result` hidden behind an opaque alias from another package may be missed | A real false positive is reported; then key on the `two-track` declaration symbols |
| `two-track-check` must-use rules see statements and void-callback arguments only | A Result stored in a variable that is read but never narrowed (`const r = f(); log(r)`) is not flagged; neither is a Result pushed into an array that is never traversed | Decide whether a flow-sensitive "narrowed or returned" analysis is worth it; it is a different class of tool |
| `two-track/testing` returns a structural `Arb<T>`, not fast-check's `Arbitrary<T>` | Passing `arbResult`/`arbDecoded` results back into `fc.record`/`fc.func` needs `as fc.Arbitrary<T>` in the test | TypeScript gains a way to express "the caller's arbitrary type" (HKT-ish), or the helpers move to a package that depends on fast-check |
| `two-track/testing` `FastCheckLike` tracks fast-check v4 | A fast-check major bump may change the structural shape | fast-check v5 is released; add the new shape or a version note |
| `oneOf` reports only the last alternative's issues | Union decode errors can be unhelpful for non-tagged unions | A caller needs it; then report per-alternative issues under an `alternatives` field |
| fast-check arbitraries are hand-written per decoder | Effect derives generators from schemas; we cannot without a schema runtime | Consider an optional `D.arbitrary` companion in a separate dev-only package |
| `cross-library.mjs` benchmark needs Ramda/Effect installed manually | Those rows cannot run in CI without adding the packages as dev deps | Decide whether comparison rows belong in CI at all (probably not) |
| No subpath exports (`two-track/result`) | Namespaces are the only grouping; some users prefer subpaths for tree-shaking clarity | First external user asks; add `exports` entries without breaking the namespaces |
| `withTimeout` uses `setTimeout` directly | One timer outside `capabilities.ts`; tests use real (short) time for it | If a `Sleeper`-based deadline proves testable without making timeouts instant |
