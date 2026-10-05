# Changelog

All notable changes to `two-track` are recorded here. The format follows Keep a Changelog; versions follow semver once published.

## [Unreleased]

### Added
- `Result`, `Option`, `Brand`, `Tagged`/`tagged`, `match`/`matchBy`/`assertNever`, `pipe`.
- Decoders: primitives, refinements, `brand`, `struct`/`array`/`record`/`nonEmptyArray`/`nullable`/`optional`/`option`, `taggedUnion`, `oneOf`, `json`, `lazy`, `custom`, `formatIssues`.
- Async railway: `AsyncResult`, `fromPromise`/`tryPromise`, `map`/`mapErr`/`andThen`/`orElse`/`match`/`tap`/`tapErr`, `all`, `mapConcurrent` (fail-fast, aborting), `validateConcurrent` (accumulating), `retry` + `backoff`, `withTimeout`.
- Capabilities: `Clock`, `Sleeper`, `Random`, `IdGen` with system and deterministic implementations.
- Repository harness: `AGENTS.md` map, `ARCHITECTURE.md`, decision records, exec plans, quality score, invariants linter with remediation messages, structural test, benchmark-as-invariant, CI.
- `Lane` namespace (decision 0009): `switchLane`, `exhaustLane`, `queueLane`, `debounce`, `throttle`, `semaphore`; tagged errors `Superseded`, `Busy`, `QueueFull`. `Cap.manualSleeper()` for deterministic timing tests.
- `two-track/testing` subpath (decision 0011): `arbResult`, `arbOption`, `arbDecoded`, `functorLaws`, `monadLaws`, `decoderRoundTrip`, `decoderNeverThrows`, `decoderDoesNotMutate`; fast-check is passed in, never depended on.
- `two-track-check` (decision 0010), a separate dev-time CLI in `tools/check` with the type-aware `ignored-result` / `floating-async-result` / `ignored-result-in-callback` / `floating-async-callback` rules (including Results dropped by `forEach` callbacks and arrays of Results from `map`), banned-construct, layer-direction, brand-cast and concurrency-hygiene rules, and `review`-severity reports for `unwrapOr` / `D.unknown`.

### Changed
- `Async.retry`: `retriable` is now required (amendment to decision 0005). Write `retriable: () => true` to retry every error explicitly.
- `Async.retry`: with a `signal`, an abort before an attempt or during a backoff wait returns `err(Aborted)` and starts no further attempt; the error type widens to `E | Aborted` only when a signal is supplied.
- `Lane.queueLane`: after a lane-level abort, waiting calls resolve `Busy` promptly (without waiting for the run in flight) and never start; the union is `E | QueueFull | Busy`.
- Packaging: `exports` gained `default` conditions and `./package.json`; declaration files no longer import `.ts` specifiers; `engines.node` is `>=20` for consumers (contributing still needs Node ≥ 22.18 for type stripping); `publishConfig` with provenance and a tag-driven release workflow.

### Fixed
- `Async.retry` ran one extra attempt, with an already-aborted signal, when the abort happened during the backoff wait (reported downstream; see docs/exec-plans/completed/0002-downstream-findings.md).

### Testing
- Model-based fast-check properties for `async`, `lanes` and `capabilities` (event sequences over `manualSleeper`/`controlledClock`, leak checks); enforced per export by the invariants script.
- `pnpm check:package`: packs the tarball, installs it, and verifies import/require/`package.json` and `tsc` with `skipLibCheck: false` under TypeScript 6 and 7.
