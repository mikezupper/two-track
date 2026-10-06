# Project review — 2026-10-05

> **Point-in-time document.** This is the review as it was written on 2026-10-05; later work superseded parts of it, and those parts are left as history. Superseded since: the full-surface bundle size (~13.6 kB then; ~20.7 kB after strict `isoDate`, `oneOf` reporting every alternative, the decoder protocol rewrite and `D.compile` — see [benchmarks](benchmarks.md#consumer-bundles) and [decision 0014](../design-docs/decisions/0014-decoder-hot-path-and-compile.md)); the "remaining limitations" on `isoDate` (now strict, [0006 amendment](../design-docs/decisions/0006-decoders-accumulate-with-path-stack.md)), `oneOf` (now reports all alternatives, same amendment) and lane throughput (now measured with gates, [0009 amendment](../design-docs/decisions/0009-lanes-trigger-coordination.md)); and the test counts (196 root tests and 39 checker tests at the time of the decision 0014 work). The method and the findings it fixed are still accurate.

Reviewed the complete library, the separate `two-track-check` implementation, tests, benchmarks, package/build scripts, architecture enforcement and CI/release configuration. Confirmed defects were reproduced with failing regressions before fixes. The final work keeps the Result/Option encodings and zero runtime dependencies.

## Findings and changes

| Area | Confirmed issue | Change and evidence |
|---|---|---|
| Async cancellation | Concurrent mapping could return a sparse successful array on cancellation; its signature omitted `Aborted` | Cancellation returns a typed error, already-aborted work never starts, and uncancellable overloads preserve their error type |
| Timeout | An already-aborted parent was not propagated; a later deadline could disappear after parent cancellation | Parent cancellation is linked immediately and the deadline resolves even if the operation ignores the aborted signal |
| Lanes | An immediately completed old switch call could escape supersession; semaphore work could run after acquisition-time cancellation | Post-race/acquisition checks, permit release and generated schedule regressions |
| Numeric options | NaN concurrency, retry attempts and permits could skip work or hang | Minimum-one normalization; queue depths normalize to nonnegative values |
| Decoders | Stateful regexes changed across calls; inherited fields were decoded; `__proto__` assignment could corrupt output | Owned/reset regex, own-field lookup and explicit own data properties; caller input/state preserved |
| Decoder errors | Spreading a large issue list into `push` could throw a RangeError | Indexed accumulation; regression returns all 300,000 issues |
| Tagged data | Caller fields could overwrite the discriminant and create conflicting intersection types | Authoritative `_tag`, with conflicting caller tag omitted from the return type |
| Checker | Invalid tsconfigs could pass, tuple analysis missed later element types, strings could masquerade as suppression comments | Configuration diagnostics retained, tuple numeric-index union checked, actual TS comment ranges scanned |
| Checker entry points | Malformed layer config/CLI arguments and direct subpath imports had gaps | Validation and namespace/direct-import regressions; CLI and project-loading tests |
| Test gates | The complete check omitted checker validation and did not enforce coverage; structural rules lacked negative fixtures | Coverage and checker checks included, per-file thresholds enforced, invariant fixtures exercise all coverage axes |
| Bundles | esbuild retained whole root namespaces for selective consumers | Additive direct module subpaths, inert constructor pure annotations, pinned two-bundler budgets and emitted-bundle smoke checks |
| CPU/allocation cost | `oneOf` allocated an unused failure; validation stored intermediate results; lane linking created temporary arrays | Early successful return, direct validation output writes with lazy errors, specialized signal linking |

The durable decisions are [coverage in the complete check](../design-docs/decisions/0012-coverage-in-the-complete-check.md) and [consumer bundles and hot paths](../design-docs/decisions/0013-consumer-bundles-and-measured-hot-paths.md). Existing async, decoder, lane and checker decisions record the contract corrections.

## Validation

`pnpm check` passed: typechecking, structural/documentation lint, root coverage suite, encoding performance gate, build, Rolldown/esbuild budgets and bundle execution, installed-package import/require checks, TypeScript 6/7 consumer checks, and the separate checker's coverage/build/self-check.

| Suite | Tests | Line coverage | Statement coverage | Function coverage | Branch coverage |
|---|---|---|---|---|---|
| Library (`src/`) | included in 180 root tests | 100% | 99.72% | 99.56% | 97.83% |
| Root, including structural invariants | 180 | 100% | 99.75% | 99.58% | 98.16% |
| Separate checker | 39 | 99.48% | 96.29% | 98.33% | 91.89% |

Both packages enforce **95% statements, lines and functions, and 90% branches per executable file**. Type-only modules have no runtime coverage; type assertions and installed-consumer checks cover their signatures. Build/package integration scripts are verified by execution rather than included in the unit coverage denominator.

Also passed a deterministic property run (`FC_RUNS=300 FC_SEED=20261005 pnpm test`), checker validation with the final stricter thresholds, and the checkout example. The encoding ratio was 1.79× the inline baseline, below the 4× gate. HTML/JSON coverage artifacts are generated in `coverage/` and `tools/check/coverage/` and remain ignored build output.

## Measured performance and bundle results

Paired compiled snapshots show approximately 18% lower time for first-alternative `oneOf`, 24% for decoder error accumulation and 9% for all-success concurrent validation. Other timing changes were within noise. These measurements exercise local CPU overhead with immediate callbacks; they do not imply faster external I/O.

With esbuild, direct imports reduce the Result consumer from 1,551 to 117 bytes and the struct decoder from 4,279 to 1,124 bytes. Selective consumers shrink by 74–95%. Rolldown already handles root namespaces well; pure annotations reduce its struct example from 1,324 to 1,119 bytes. The complete runtime remains about 13.5–13.8 kB minified and 4.8 kB gzip; it did not materially shrink. See [benchmark methods and detailed results](benchmarks.md).

## Remaining limitations

Coverage measures executed code, not a proof of total correctness. Generated cancellation schedules, algebraic laws, boundary regressions and consumer type checks supplement it.

`isoDate` accepts strings the engine's `Date` parser recognizes, including some non-ISO forms and normalized invalid calendar dates. This review documented that existing behavior rather than silently narrowing a public decoder. `oneOf` still reports only the final alternative's issues. Generic ESLint rules and trigger-throughput measurements for lanes other than the semaphore remain gaps. Retirement conditions are tracked in [technical debt](../exec-plans/tech-debt-tracker.md).
