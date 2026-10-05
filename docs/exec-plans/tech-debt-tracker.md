# Tech debt tracker

| Item | Why it is debt | Retire when |
|---|---|---|
| No ESLint / type-aware lint (decision 0007) | `switch-exhaustiveness-check` and `no-floating-promises` are currently reviewer checks | typescript-eslint supports TS ≥ 7.1, or Biome gains type-aware rules worth the dependency |
| `oneOf` reports only the last alternative's issues | Union decode errors can be unhelpful for non-tagged unions | A caller needs it; then report per-alternative issues under an `alternatives` field |
| fast-check arbitraries are hand-written per decoder | Effect derives generators from schemas; we cannot without a schema runtime | Consider an optional `D.arbitrary` companion in a separate dev-only package |
| `cross-library.mjs` benchmark needs Ramda/Effect installed manually | Those rows cannot run in CI without adding the packages as dev deps | Decide whether comparison rows belong in CI at all (probably not) |
| No subpath exports (`two-track/result`) | Namespaces are the only grouping; some users prefer subpaths for tree-shaking clarity | First external user asks; add `exports` entries without breaking the namespaces |
| `withTimeout` uses `setTimeout` directly | One timer outside `capabilities.ts`; tests use real (short) time for it | If a `Sleeper`-based deadline proves testable without making timeouts instant |
