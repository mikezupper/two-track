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
- `two-track-check` (decision 0010), a separate dev-time CLI in `tools/check` with the type-aware `ignored-result` / `floating-async-result` rules, banned-construct, layer-direction, brand-cast and concurrency-hygiene rules, and `review`-severity reports for `unwrapOr` / `D.unknown`.

### Changed
- `Async.retry`: `retriable` is now required (amendment to decision 0005). Write `retriable: () => true` to retry every error explicitly.
