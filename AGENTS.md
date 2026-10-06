# AGENTS.md — the map

`two-track` is a zero-dependency railway-oriented programming library for TypeScript. This file is a table of contents, not a manual: read it, then follow the pointers for the area you are touching.

## What this repository is

- A library: `src/` is the whole product, ~2,100 lines across 14 modules, no runtime dependencies, runs in any ES2023 engine.
- The fastest expression of `Result`/`Option`/decoders/exhaustive match/async railway that JavaScript engines can run. Speed is a tested invariant (`pnpm bench:check`).
- The reference implementation behind the `two-track-fp-skill` coding-agent skill. Changes here change what that skill teaches.

## Non-negotiables (enforced by `scripts/invariants.ts`, with the fix in every message)

- Zero runtime dependencies in the library (root `package.json`). Implement helpers in `src/`; dev dependencies are fine. `tools/check` is a separate package and may depend on TypeScript 6.
- In `src/`: no `throw` (except `assertNever`), no `try` (except the four interop edges: `fromThrowable`, `tryPromise`, `D.json`, and the one-time `new Function` probe in `decode-compile`), no `.catch(`, no `any`, no generators, no `Object.freeze`, no classes, no `console`, no `node:` imports, no platform time/random/timers outside `capabilities.ts` (the one documented exception: `withTimeout`'s `setTimeout` in `async.ts`).
- Layer direction per the `LAYERS` table in `scripts/invariants.ts` and `ARCHITECTURE.md`. New module → register it in both; the module table's line counts are checked against `wc -l` (`architecture-line-counts`).
- Every export of `src/async.ts`, `src/lanes.ts`, `src/capabilities.ts` appears in `test/<module>.properties.test.ts` (fast-check over generated schedules with `Cap.manualSleeper`/`controlledClock`).
- Every `docs/` link resolves; every decision file is listed in `docs/design-docs/index.md`; every active plan has `## Progress` and `## Decision log`.
- Encoding contract: `Result` is `{ ok: true, value } | { ok: false, error }`, `Option` is `{ some: true, value } | { some: false }`. User code narrows on these; do not rename.

## Commands

```bash
pnpm check         # definition of done: typecheck + lint + coverage + bench:check + check:lanes + build + check:bundle + check:package + check:tools
pnpm check:tools   # the two-track-check package (tools/check): its typecheck + coverage + build + self-check
pnpm check:package # pack + install + import/require + tsc under TS 6 and 7 as a consumer
pnpm check:lanes   # lane throughput ratio gates vs a same-run baseline (bench/lanes.ts --check)
pnpm check:bundle  # consumer bundle byte budgets + runtime smoke, Rolldown and esbuild (after build)
pnpm test          # vitest (unit, fast-check properties, structural invariants, example)
pnpm test:coverage # library + invariant coverage, with per-file thresholds
pnpm lint          # node scripts/lint-invariants.ts
pnpm build         # tsc -p tsconfig.build.json, then rewrite .ts specifiers in the emitted .d.ts
pnpm bench         # bench/encodings.ts   (--check enforces the 4x ratio)
pnpm bench:hot     # bench/hot-paths.ts   decoder / async CPU overhead, interpreted and compiled
pnpm bench:lanes   # bench/lanes.ts       per-trigger overhead of every lane
pnpm bench:bundle  # bench/bundles.mjs    minified/gzip/brotli consumer sizes
pnpm bench:cross   # bench/cross/         decoders vs Zod/Valibot/ArkType, railway vs Ramda/Effect (report only)
pnpm example       # node examples/checkout.ts
```

Node ≥ 22.18 runs `.ts` directly (type stripping); keep all syntax erasable.

## Where to look next

| Working on | Read first |
|---|---|
| Anything | `ARCHITECTURE.md` (module map, layers, permitted edges) |
| Why something is shaped the way it is | `docs/design-docs/index.md` → the decision record; `docs/design-docs/core-beliefs.md` |
| `src/result.ts`, `src/option.ts` | Decision 0001 (encoding), 0002 (no generators), 0003 (no freeze); laws in `test/result.test.ts` |
| `src/decode*.ts` | Decision 0006 (accumulate every issue), 0014 (value-or-Failure protocol, inline primitives, `compile`); `test/decode.test.ts` round-trips, `test/decode-compile.test.ts` equivalence properties |
| `src/async.ts`, `src/capabilities.ts` | Decision 0005 (AsyncResult never rejects; AbortSignal everywhere; `retriable` required), 0004 (capabilities) |
| `src/lanes.ts` | Decision 0009 (trigger coordination vs fan-out); `test/lanes.test.ts` and the enforced `test/lanes.properties.test.ts` use `Cap.manualSleeper` |
| `src/testing.ts` (`two-track/testing`) | Decision 0011 (fast-check injected, never depended on) |
| `tools/check/` (`two-track-check`) | Decision 0010; it has its OWN deps (TypeScript 6 API) and its own `pnpm check`; the root `check:tools` runs it |
| Performance | `docs/references/benchmarks.md`, `bench/encodings.ts` |
| Tooling, lint, CI | Decisions 0007 (TS 7 + custom invariants), 0012 (coverage in the check), 0013 (bundles, subpaths); `scripts/invariants.ts`; `.github/workflows/ci.yml` |
| Planning a multi-step change | `docs/exec-plans/README.md`; put the plan in `docs/exec-plans/active/` |
| Known gaps | `docs/exec-plans/tech-debt-tracker.md`, `docs/QUALITY_SCORE.md` |
| How application code should use this | the companion skill repo `two-track-fp-skill` (SKILL.md + references) |

## How to make a change

1. If the change is non-obvious, write or update a decision record (`docs/design-docs/decisions/NNNN-*.md`) and index it. Multi-step work gets an exec plan.
2. Model types first, then tests (laws and properties before examples), then the implementation.
3. Run `pnpm check`. Fix every invariant violation by applying the fix in its message, not by widening the allowlist — widening needs a sentence in the decision record.
4. If a benchmark number moved, update `docs/references/benchmarks.md` and the README table.
5. Update `docs/QUALITY_SCORE.md` if a module's grade changed. Add a `CHANGELOG.md` entry.
6. Self-review as a hostile reviewer: read every exported signature's error type; check for a `default` over a union; check for a new allocation on a hot path.

## What not to do

- Do not add a runtime dependency, a class-based Result, generator do-notation, or `Object.freeze` — each is a measured regression with a decision record explaining why.
- Do not add a `default` case over a domain union; use `match` or `assertNever`.
- Do not write documentation that duplicates code; link to the code and state the intent and the evidence.
