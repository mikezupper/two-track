# 0002 — Findings from a downstream consumer (Gyral) at 3cd27ee

Owner: Claude (Fable 5.1) steered by Mike Zupper   Started: 2026-10-05   Status: completed 2026-10-05

## Goal

Resolve every issue a downstream project reported while building against two-track at commit 3cd27ee (Node 24.15.0), and turn each one into a mechanical check so it cannot regress.

## Findings and resolutions

| # | Finding | Resolution | Guard |
|---|---|---|---|
| 1 | `Async.retry` made one extra attempt after its signal aborted during the backoff wait (checked `signal.aborted` only before sleeping; sleepers resolve, not reject, on abort) | Re-check after the sleep and before every attempt; return `err(Aborted)`; the error type widens to `E \| Aborted` only when a `signal` is supplied (overloads). Decision 0005 amended | Regression tests with `Cap.manualSleeper` and with the real `systemSleeper`; property "no run after abort" in `test/async.properties.test.ts` |
| 2 | Time-dependent modules (`async`, `lanes`, `capabilities`) had only example tests, while the pure modules had properties | Model-based fast-check properties over generated event sequences with `manualSleeper`/`controlledClock`; leak checks (no pending timers, no abort listeners left) | Invariant `property-tests-exist` / `property-test-coverage`: every export of those modules must appear in its `*.properties.test.ts` |
| 2b | `queueLane` after a lane-level abort started queued calls with an already-aborted signal — undocumented | Waiting calls now resolve `Busy` promptly and never start; new calls after the abort are `Busy`. Decision 0009 amended | Example test + property |
| P1 | `exports` had only an `import` condition: no `default`, no `./package.json` | Added `default` conditions and the `./package.json` export | `scripts/check-package.mjs` does `require("two-track")` and `require("two-track/package.json")` |
| P2 | Emitted `.d.ts` imported `./result.ts` (`rewriteRelativeImportExtensions` rewrites JS only); consumers with `skipLibCheck: false` failed | `scripts/fix-dts-extensions.ts` runs after `tsc` in `pnpm build` | `check-package.mjs` compiles a consumer with `skipLibCheck: false` under TypeScript 6 and 7 |
| P3 | Toolchain requirements overstated: Node ≥ 22.18 and TS 7 are for developing the repo, not for consuming `dist/` | `engines.node` is `>=20`; README states consumer requirements separately from contributor requirements | Same consumer check runs on TS 6 |
| P4 | Not published to npm | `publishConfig` (public, provenance) and `.github/workflows/release.yml` using npm trusted publishing on `v*` tags; publishing itself needs the one-time trusted-publisher setup on npmjs.com by the owner | Release workflow runs the full check and verifies the tag matches the version |

## Found by the new properties while closing finding 2

| Finding | Resolution | Guard |
|---|---|---|
| `queueLane` waiters learned of a lane abort only when the run ahead of them finished (the waiter was chained on `tail.then`), so "resolve Busy promptly" was not true while a run was in flight (minimized: depth 1, `[call, call, abortLane]`; seed −1045923396) | Each waiting call races its queue slot against the lane abort; once its run has started it returns that run's own result; the abort listener is removed either way | Strict property "waiters resolve Busy promptly after a lane abort, even while a run is in flight" in `test/lanes.properties.test.ts` |

## Decision log

- 2026-10-05 — `retry` gets an explicit `Aborted` outcome rather than returning the last error: callers could not distinguish cancellation from exhaustion. Overloads keep the un-cancellable signature unchanged.
- 2026-10-05 — `queueLane` waiters resolve `Busy` on lane abort, mirroring `semaphore`, instead of starting with an aborted signal.
- 2026-10-05 — the property-test requirement is enforced per export by the invariants script rather than by review, so a new time-dependent export cannot ship without one.
