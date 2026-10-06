# Quality score

Graded per module on four axes: **Types** (does the signature say everything), **Tests** (unit + laws + properties), **Perf** (measured, on a hot path or not), **Docs** (intent and decision linked). A = nothing known to improve; B = minor gap listed; C = real gap, tracked in tech debt. Updated with every change that moves a grade.

| Module | Types | Tests | Perf | Docs | Notes |
|---|---|---|---|---|---|
| `result.ts` | A | A | A | A | functor + monad laws; traverse ≡ all∘map property; latest Node `bench:check` ratio 1.79x; direct esbuild consumer 117 B |
| `option.ts` | A | A | A | A | laws; `none` singleton allocation-free |
| `brand.ts` | A | A | A | A | type-only; forging guarded by the skill's review grep |
| `tagged.ts` | A | A | B | A | authoritative tag and conflicting-field types tested; `tagged()` spreads fields (cold path: errors only) |
| `match.ts` | A | A | A | A | compile-time exhaustiveness tested with `@ts-expect-error` |
| `fn.ts` | A | A | A | B | `pipe` overloads to 8; no `flow` (by design, add on demand) |
| `decode.ts` | A | A | A | A | round-trip, regex state, own-property and 300,000-issue regressions; measured `oneOf` and accumulation gains; union reporting and ISO grammar gaps tracked |
| `capabilities.ts` | A | A | A | A | seeded PRNG determinism tested |
| `async.ts` | A | A | A | A | model-based schedules, abort points and leak checks; cancellation signatures tested; map/validation CPU overhead now benchmarked |
| `lanes.ts` | A | A | B | A | model-based properties and cancellation races; semaphore CPU overhead measured; trigger throughput for other lanes remains unmeasured |
| `testing.ts` | A | A | — | A | helpers proven against R/O and a broken functor; `FastCheckLike` is public surface |
| `index.ts` | A | — | — | A | surface documented in ARCHITECTURE.md |
| `tools/check` (two-track-check) | A | A | — | A | TS 6 API; rule, CLI, config and project-loading fixtures; 99.48% lines / 91.89% branches; self-check and examples |

**Repository**

| Axis | Grade | Notes |
|---|---|---|
| Invariants coverage | A | source rules + layers + docs integrity + plan shape have negative fixtures; `scripts/invariants.ts` has 100% coverage on all axes; application-level rules in `two-track-check` |
| CI | A | typecheck, invariants, coverage, build, consumer check (TS 6 + 7), two-bundler budgets, checker package; timing report-only on shared runners (ratio enforced locally); tag-driven release with provenance |
| Coverage | A | library 100% lines / 97.83% branches; both packages enforce 95% statements/lines/functions and 90% branches per executable file; generated schedules required for time-dependent exports |
| Docs freshness | A | links checked by linter; decisions indexed by linter |
| Lint (type-aware) | B | `two-track-check` (decision 0010) covers the foot-guns incl. ignored Results; no generic ESLint rules yet |
