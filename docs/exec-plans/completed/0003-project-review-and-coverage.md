# 0003 — Project review and test coverage
Owner: Codex   Started: 2026-10-05   Status: completed

## Goal
Review the library, checker, supporting scripts, and tests; verify all project checks and measure coverage; fix confirmed defects and meaningful gaps. Identify performance bottlenecks and reduce bundle size where measurements support it.

## Steps
1. Read the architecture and decisions; run the existing checks and coverage suites.
2. Review every implementation module and compare its behavior with the tests and public contracts.
3. Add regression tests before fixes; make coverage enforcement match the repository's validation contract.
4. Measure decoding, async orchestration, and tree-shaken bundle size; optimize measured bottlenecks and unnecessary allocations.
5. Run the complete validation commands and record results and remaining limitations.

## Progress
- [x] 2026-10-05 Read the repository map, architecture, quality score, and validation configuration; started the baseline full check.
- [x] 2026-10-05 Reviewed all library and checker implementations, supporting scripts, and tests; measured baseline coverage.
- [x] 2026-10-05 Added failing regressions before fixing cancellation, decoder, lane, and checker defects; added CLI and invariant enforcement coverage.
- [x] 2026-10-05 Measured compiled decoder/async snapshots and Rolldown/esbuild consumers; removed unnecessary allocations and added smaller direct module imports with budget checks.
- [x] 2026-10-05 Complete check passed: 180 root tests, 39 checker tests, coverage, package/consumer checks, bundle budgets and encoding ratio 1.79x. Repeated properties with 300 generated cases and a fixed seed. Recorded [the review](../../references/project-review.md) and [measurements](../../references/benchmarks.md).

## Decision log
- 2026-10-05 — Review includes the separate `tools/check` package and supporting scripts because the requested scope is the whole project. Coverage will be measured from fresh runs, not the existing ignored report.
- 2026-10-05 — User expanded the review to performance bottlenecks and bundle size; preserve correctness fixes and compare optimized code against measured baselines.
- 2026-10-05 — Enforce per-file coverage in both packages and include checker validation in the complete check; [decision 0012](../../design-docs/decisions/0012-coverage-in-the-complete-check.md).
- 2026-10-05 — Preserve namespace imports while adding direct module subpaths; measure both bundlers and keep CPU timings report-only outside the encoding gate; [decision 0013](../../design-docs/decisions/0013-consumer-bundles-and-measured-hot-paths.md).
- 2026-10-05 — Document permissive `isoDate` behavior as debt rather than narrowing the decoder without a format decision; make no full-bundle or noisy semaphore speed claim.
