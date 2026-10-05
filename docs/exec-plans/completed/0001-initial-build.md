# 0001 — Initial build of two-track

Owner: Claude (Fable 5.1) steered by Mike Zupper   Started: 2026-10-05   Status: completed 2026-10-05

## Goal

Produce the zero-dependency railway library that the third FP skill (after rust-fp-skill and effect-fp-skill) is built around, with its speed claims measured and enforced, organized as an agent-first repository.

## Steps

1. Measure candidate encodings and the cross-library field (Ramda, Effect, WASM, native Rust) before writing any library code.
2. Scaffold: pnpm, TypeScript 7 strict, vitest + fast-check, native type stripping for scripts.
3. Core algebra: `result`, `option`, `brand`, `tagged`, `match`, `fn`.
4. Boundary: `decode` with accumulation and path stack.
5. Shell: `capabilities`, `async` (concurrency, retry, timeout, AbortSignal).
6. Tests: unit + laws + round-trips + concurrency bounds; coverage thresholds.
7. Harness: invariants linter with remediation, structural test, benchmark-as-invariant, AGENTS/ARCHITECTURE/docs, CI.
8. README as the system of record for motivation, decisions, architecture, tradeoffs, conventions.

## Progress

- [x] 2026-10-05 step 1 — numbers recorded in `docs/references/benchmarks.md`
- [x] 2026-10-05 steps 2–5 — `src/` complete, 9 modules, ~900 lines
- [x] 2026-10-05 step 6 — 68 tests, 99.6% statements / 97.7% branches
- [x] 2026-10-05 step 7 — `pnpm check` green; ESLint dropped (decision 0007)
- [x] 2026-10-05 step 8 — README, AGENTS.md, ARCHITECTURE.md, 8 decisions, quality score

## Decision log

- 2026-10-05 — chose the name `two-track` (Wlaschin's term; available on npm) over `railway-ts`, `shunt-ts`.
- 2026-10-05 — two-shape boolean encoding beats monomorphic/tagged/class encodings on both engines (→ 0001).
- 2026-10-05 — generators 40–80x, freeze 10–20x: banned, not discouraged (→ 0002, 0003).
- 2026-10-05 — typescript-eslint cannot load under TS 7.0; custom invariants carry the architecture rules instead (→ 0007).
- 2026-10-05 — `withTimeout` keeps a direct `setTimeout` (allowlisted) rather than taking a Sleeper, since a race against a deadline is not something tests want to make instant.
