# Quality score

Graded per module on four axes: **Types** (does the signature say everything), **Tests** (unit + laws + properties), **Perf** (measured, on a hot path or not), **Docs** (intent and decision linked). A = nothing known to improve; B = minor gap listed; C = real gap, tracked in tech debt. Updated with every change that moves a grade.

| Module | Types | Tests | Perf | Docs | Notes |
|---|---|---|---|---|---|
| `result.ts` | A | A | A | A | functor + monad laws; traverse ≡ all∘map property; Node `bench:check` ratio ~1.8x across recent runs; direct esbuild consumer 117 B |
| `option.ts` | A | A | A | A | laws; `none` singleton allocation-free |
| `brand.ts` | A | A | A | A | type-only; forging guarded by the skill's review grep |
| `tagged.ts` | A | A | B | A | authoritative tag and conflicting-field types tested; `tagged()` spreads fields (cold path: errors only) |
| `match.ts` | A | A | A | A | compile-time exhaustiveness tested with `@ts-expect-error` |
| `fn.ts` | A | A | A | B | `pipe` overloads to 8; no `flow` (by design, add on demand) |
| `decode-*.ts` | A | A | A | A | round-trip, regex state, own-property and 300,000-issue regressions; strict `isoDate`; `oneOf` reports every alternative; interpreter 1.2–1.5x faster after the protocol rewrite; `compile` proven equivalent by property (1,100+ generated cases) and CSP fallback tested; vs the field: 20–35% faster than Zod/Valibot interpreted, compiled within 1.4x of ArkType on valid input and 4x faster on invalid |
| `capabilities.ts` | A | A | A | A | seeded PRNG determinism tested |
| `async.ts` | A | A | A | A | model-based schedules, abort points and leak checks; cancellation signatures tested; map/validation CPU overhead now benchmarked |
| `lanes.ts` | A | A | A | A | model-based properties and cancellation races; every lane's per-trigger cost measured with ratio gates in the check; semaphore queue made linear |
| `testing.ts` | A | A | — | A | helpers proven against R/O and a broken functor; `FastCheckLike` is public surface |
| `index.ts` | A | — | — | A | surface documented in ARCHITECTURE.md |
| `tools/check` (two-track-check) | A | A | — | A | TS 6 API; rule, CLI, config and project-loading fixtures; 99.49% lines / 92.26% branches (2026-10-06, after `no-process-env` and the identifier-statement must-use path); self-check and examples |

**Repository**

| Axis | Grade | Notes |
|---|---|---|
| Invariants coverage | A | source rules + layers + docs integrity + plan shape have negative fixtures; `scripts/invariants.ts` is at ≥98% on every axis with a negative fixture per rule (incl. `architecture-line-counts`); application-level rules in `two-track-check` |
| CI | A | typecheck, invariants, coverage, lane ratio gates, build, two-bundler budgets, consumer check (TS 6 + 7), checker package, report-only `bench` and `bench:cross`; tag-driven release with provenance |
| Coverage | A | library 100% lines / 98.3% branches / 99.7% statements (2026-10-06); both packages enforce 95% statements/lines/functions and 90% branches per executable file; generated schedules required for time-dependent exports |
| Docs freshness | A | links, decision index, architecture line counts and headline measurement rows all checked by the invariants script; prose figures by review |
| Lint (type-aware) | B | `two-track-check` (decision 0010) covers the foot-guns incl. ignored Results; no generic ESLint rules yet |
