# Quality score

Graded per module on four axes: **Types** (does the signature say everything), **Tests** (unit + laws + properties), **Perf** (measured, on a hot path or not), **Docs** (intent and decision linked). A = nothing known to improve; B = minor gap listed; C = real gap, tracked in tech debt. Updated with every change that moves a grade.

| Module | Types | Tests | Perf | Docs | Notes |
|---|---|---|---|---|---|
| `result.ts` | A | A | A | A | functor + monad laws; traverse ≡ all∘map property; `bench:check` ratio 1.6–1.9x |
| `option.ts` | A | A | A | A | laws; `none` singleton allocation-free |
| `brand.ts` | A | A | A | A | type-only; forging guarded by the skill's review grep |
| `tagged.ts` | A | A | B | A | `tagged()` spreads fields (cold path: errors only) |
| `match.ts` | A | A | A | A | compile-time exhaustiveness tested with `@ts-expect-error` |
| `fn.ts` | A | A | A | B | `pipe` overloads to 8; no `flow` (by design, add on demand) |
| `decode.ts` | A | A | A | A | round-trip, never-throws, no-mutation properties; `oneOf` issue reporting is B (tech debt) |
| `capabilities.ts` | A | A | A | A | seeded PRNG determinism tested |
| `async.ts` | A | A | B | A | examples + model-based properties (schedules, abort points, leak checks); retry cancellation regression covered; perf not benchmarked (I/O bound by nature) |
| `lanes.ts` | A | A | B | A | switch/exhaust/queue/debounce/throttle/semaphore; examples + model-based properties with leak checks; not benchmarked (trigger-rate bound) |
| `testing.ts` | A | A | — | A | helpers proven against R/O and a broken functor; `FastCheckLike` is public surface |
| `index.ts` | A | — | — | A | surface documented in ARCHITECTURE.md |
| `tools/check` (two-track-check) | A | A | — | A | separate package on TS 6 API; fixtures per rule; runs on its own src and on examples/ |

**Repository**

| Axis | Grade | Notes |
|---|---|---|
| Invariants coverage | A | 17 source rules + layers + docs integrity + plan shape in `scripts/invariants.ts`; application-level rules in `two-track-check` |
| CI | A | typecheck, invariants, tests, build, consumer check (TS 6 + 7), checker package; bench report-only on shared runners (ratio enforced locally); tag-driven release with provenance |
| Coverage | A | ≥ 99% statements (thresholds 95/90); property-test coverage per export enforced for time-dependent modules |
| Docs freshness | A | links checked by linter; decisions indexed by linter |
| Lint (type-aware) | B | `two-track-check` (decision 0010) covers the foot-guns incl. ignored Results; no generic ESLint rules yet |
