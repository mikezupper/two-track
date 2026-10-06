# 0013 — Direct module imports and measured hot-path optimizations
Status: accepted        Date: 2026-10-05

## Context
The user requested a review of performance bottlenecks and bundle size. The existing encoding benchmark measured Result combinators but neither decoder/async costs nor consumer bundles. Rolldown pruned the root namespaces effectively; esbuild retained the entire Result or decoder namespace even when a consumer selected a single member.

## Decision
Publish additive direct module subpaths alongside the root namespaces. Mark only inert module-level constructor calls as pure so bundlers can drop unused decoder and error constants. Check representative consumer bundles with pinned Rolldown and esbuild, compressed sizes and runtime smoke checks; enforce byte budgets after building. Keep raw modules and declarations as the published output rather than shipping a pre-bundled runtime.

Remove `oneOf`'s eager failure allocation; append decoder issues through one cold helper without spreading unbounded arrays into call arguments; write concurrent validation successes directly to their final positions and allocate failure storage only on error; remove the two temporary arrays from lane signal linking. Preserve error ordering, cancellation, input ownership and microtask scheduling.

## Evidence
Methods and before/after numbers are in [benchmarks](../../references/benchmarks.md). The esbuild Result consumer falls from 1,551 bytes through the root namespace to 117 through the subpath; a struct consumer falls from 4,279 to 1,124. A large nested decoding regression formerly threw a RangeError and now returns all 300,000 issues. The first-alternative `oneOf` and error accumulation benchmarks improve; semaphore overhead is within noise, so no numerical speed claim is made for it.

## Alternatives
Forcing bundler side effects off or changing namespace semantics would mask rather than fix compatibility differences. Pre-minifying published modules would reduce readability without resolving opaque namespace imports. Shared AbortSignals or skipping awaits could reduce orchestration overhead but change identity or scheduling semantics; neither was adopted.

## Consequences
Subpaths are additive and preserve the original API. [Consumer checks](../../../scripts/check-package.mjs) import and require every entry and compile under TS 6 and 7. [Bundle checks](../../../bench/bundles.mjs) run in the complete check and CI. [Hot-path benchmarks](../../../bench/hot-paths.ts) are report-only because small timing differences depend on the machine. These tools are development dependencies; the library still has zero runtime dependencies.
