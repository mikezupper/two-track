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
| `async.ts` | A | A | B | A | peak-concurrency, fail-fast abort, retry/backoff, timeout tested; perf not benchmarked (I/O bound by nature) |
| `index.ts` | A | — | — | A | surface documented in ARCHITECTURE.md |

**Repository**

| Axis | Grade | Notes |
|---|---|---|
| Invariants coverage | A | 17 source rules + layers + docs integrity + plan shape; remediation in every message |
| CI | B | bench is report-only on shared runners (noise); ratio enforced locally |
| Coverage | A | 99.6% statements, 97.7% branches (thresholds 95/90) |
| Docs freshness | A | links checked by linter; decisions indexed by linter |
| Lint (type-aware) | C | none (decision 0007; tech debt) |
