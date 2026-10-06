# Design docs — index

The system of record for *why*. Every non-obvious choice has a decision record here; the invariants linter fails if a decision file exists that is not listed in this table.

**Template for a new decision** (`decisions/NNNN-kebab-title.md`):

```
# NNNN — Title
Status: accepted | superseded by NNNN | rejected        Date: YYYY-MM-DD
## Context         what forced a choice
## Decision        what we do, in one paragraph
## Evidence        the measurement, type-level fact, or constraint that decided it
## Alternatives    what was rejected and why
## Consequences    what this makes easy, hard, or forbidden; which invariant enforces it
```

## Core beliefs

- [core-beliefs.md](core-beliefs.md) — the agent-first operating principles for this repository.

## Decisions

| # | Decision | Status | Enforced by |
|---|---|---|---|
| [0001](decisions/0001-result-encoding.md) | `Result`/`Option` are two plain object shapes with a boolean discriminant; no classes | accepted | `no-class` invariant; `bench:check` ratio |
| [0002](decisions/0002-no-generator-do-notation.md) | No generator-based do-notation, in the library or in recommended usage | accepted | `no-generators` invariant |
| [0003](decisions/0003-compile-time-immutability.md) | Immutability is `readonly` types, never `Object.freeze` | accepted | `no-freeze` invariant |
| [0004](decisions/0004-zero-runtime-dependencies.md) | Zero runtime dependencies; capabilities as values instead of a DI runtime | accepted | `zero-runtime-deps` invariant; `no-node-imports` |
| [0005](decisions/0005-async-result.md) | `AsyncResult` is an eager `Promise<Result>` that never rejects; `AbortSignal` threaded everywhere | accepted | `no-catch-method` invariant; async tests |
| [0006](decisions/0006-decoders-accumulate-with-path-stack.md) | Decoders accumulate all issues; the path is a mutable stack owned by the call | accepted | decode round-trip and never-throws properties |
| [0007](decisions/0007-toolchain-ts7-custom-invariants.md) | TypeScript 7 for types; custom invariants script for architecture; no ESLint until typescript-eslint supports TS ≥ 7.1 | accepted | `scripts/invariants.ts`; CI |
| [0008](decisions/0008-data-first-namespaced-api.md) | Data-first function signatures; module namespaces `R O D Async Cap`; no point-free/currying | accepted | API shape; README conventions |
| [0009](decisions/0009-lanes-trigger-coordination.md) | `Lane`: switch/exhaust/queue/debounce/throttle/semaphore — trigger coordination, distinct from fan-out | accepted | lanes tests (peak concurrency, abort, ordering) |
| [0010](decisions/0010-checker-as-separate-package.md) | `two-track-check` ships as a separate dev package on TypeScript 6's API; type-aware `ignored-result` rule | accepted | `tools/check` tests; CI `check:tools` |
| [0011](decisions/0011-testing-helpers-inject-fast-check.md) | `two-track/testing` law/round-trip helpers take fast-check as a parameter; no dependency | accepted | `test/testing.test.ts` |
| [0012](decisions/0012-coverage-in-the-complete-check.md) | Coverage per file, negative invariant tests and the checker are part of the complete check | accepted | both coverage configs; `pnpm check` |
| [0013](decisions/0013-consumer-bundles-and-measured-hot-paths.md) | Additive module subpaths, consumer bundle budgets and measured allocation reductions | accepted | bundle and consumer checks; hot-path benchmarks |
| [0014](decisions/0014-decoder-hot-path-and-compile.md) | Decoder protocol rewritten for speed (value-or-Failure, inline primitives); `D.compile` opt-in literal-key codegen with CSP fallback | accepted | `test/decode-compile.test.ts` equivalence properties; `bench/cross` rows |
