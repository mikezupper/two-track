# Changelog

All notable changes to `two-track` are recorded here. The format follows Keep a Changelog; versions follow semver once published.

## [Unreleased]

### Added
- Direct module subpaths (`two-track/result`, `option`, `decode`, `async`, `capabilities`, `lanes`, `tagged`, `match`, `fn`, `brand`) for smaller consumer bundles while preserving root namespaces.
- Decoder/async throughput benchmarks and Rolldown/esbuild consumer bundle checks with byte budgets and runtime smoke checks.
- `Result`, `Option`, `Brand`, `Tagged`/`tagged`, `match`/`matchBy`/`assertNever`, `pipe`.
- Decoders: primitives, refinements, `brand`, `struct`/`array`/`record`/`nonEmptyArray`/`nullable`/`optional`/`option`, `taggedUnion`, `oneOf`, `json`, `lazy`, `custom`, `formatIssues`.
- Async railway: `AsyncResult`, `fromPromise`/`tryPromise`, `map`/`mapErr`/`andThen`/`orElse`/`match`/`tap`/`tapErr`, `all`, `mapConcurrent` (fail-fast, aborting), `validateConcurrent` (accumulating), `retry` + `backoff`, `withTimeout`.
- Capabilities: `Clock`, `Sleeper`, `Random`, `IdGen` with system and deterministic implementations.
- Repository harness: `AGENTS.md` map, `ARCHITECTURE.md`, decision records, exec plans, quality score, invariants linter with remediation messages, structural test, benchmark-as-invariant, CI.
- `Lane` namespace (decision 0009): `switchLane`, `exhaustLane`, `queueLane`, `debounce`, `throttle`, `semaphore`; tagged errors `Superseded`, `Busy`, `QueueFull`. `Cap.manualSleeper()` for deterministic timing tests.
- `two-track/testing` subpath (decision 0011): `arbResult`, `arbOption`, `arbDecoded`, `functorLaws`, `monadLaws`, `decoderRoundTrip`, `decoderNeverThrows`, `decoderDoesNotMutate`; fast-check is passed in, never depended on.
- `two-track-check` (decision 0010), a separate dev-time CLI in `tools/check` with the type-aware `ignored-result` / `floating-async-result` / `ignored-result-in-callback` / `floating-async-callback` rules (including Results dropped by `forEach` callbacks and arrays of Results from `map`), banned-construct, layer-direction, brand-cast and concurrency-hygiene rules, and `review`-severity reports for `unwrapOr` / `D.unknown`.

### Changed
- `pnpm check` now enforces coverage per file, bundle budgets, and the separate checker package's full check. Both packages require 95% statements/lines/functions and 90% branches per executable file.
- `Async.mapConcurrent` adds `Aborted` to cancellable calls' error unions; typed options and retry policies with optional signals are accepted.
- `oneOf` skips its eager failure allocation, concurrent validation writes directly into its final success array and creates failure storage only on demand, and lane signal linking avoids temporary arrays.
- `Async.retry`: `retriable` is now required (amendment to decision 0005). Write `retriable: () => true` to retry every error explicitly.
- `Async.retry`: with a `signal`, an abort before an attempt or during a backoff wait returns `err(Aborted)` and starts no further attempt; the error type widens to `E | Aborted` only when a signal is supplied.
- `Lane.queueLane`: after a lane-level abort, waiting calls resolve `Busy` promptly (without waiting for the run in flight) and never start; the union is `E | QueueFull | Busy`.
- Packaging: `exports` gained `default` conditions and `./package.json`; declaration files no longer import `.ts` specifiers; `engines.node` is `>=20` for consumers (contributing still needs Node ≥ 22.18 for type stripping); `publishConfig` with provenance and a tag-driven release workflow.

### Fixed
- Caller cancellation no longer yields an incomplete `mapConcurrent` success; pre-aborted parents propagate to concurrent maps and timeouts, and deadlines still fire if work ignores cancellation.
- Decoder `__proto__` fields remain ordinary own properties, inherited struct fields are absent, global/sticky patterns are deterministic without mutating caller regexes, and large nested issue lists no longer overflow argument limits.
- Same-turn switch bursts supersede stale successes; semaphore cancellation between permit acquisition and callback start returns Busy and restores the permit. NaN counts and fractional queue depths obey normalized bounds.
- `tagged` keeps its declared discriminant in both the returned object and its type when fields carry a conflicting tag.
- The checker rejects invalid tsconfig diagnostics, layer arrays and malformed CLI arguments; recognizes Results anywhere in a tuple; and reads suppression directives only from actual comments.
- `Async.retry` ran one extra attempt, with an already-aborted signal, when the abort happened during the backoff wait (reported downstream; see docs/exec-plans/completed/0002-downstream-findings.md).

### Testing
- CLI, config/project failure paths, direct subpath imports, negative architecture invariants, large nested decoding and cancellation race regressions; HTML and JSON coverage reports for both packages.
- Model-based fast-check properties for `async`, `lanes` and `capabilities` (event sequences over `manualSleeper`/`controlledClock`, leak checks); enforced per export by the invariants script.
- `pnpm check:package`: packs the tarball, installs it, and verifies import/require/`package.json` and `tsc` with `skipLibCheck: false` under TypeScript 6 and 7.
