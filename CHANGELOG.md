# Changelog

All notable changes to `two-track` are recorded here. The format follows Keep a Changelog; versions follow semver once published.

## [Unreleased]

### Added
- `D.compile` now generates native code for `taggedUnion` (if/else over the discriminant, the unknown-tag issue at the same path as the interpreter) and `record`; the opaque set is down to `map`, `andThen`, `custom`, `lazy`, `oneOf`, `json`, and `refine` over a non-primitive. `pattern` checks run inline (`regex.test`) in both the interpreter and the generated code, with the caller's regex never touched and global/sticky regexes reset.
- `D.compile(decoder)` (decision 0014): opt-in code-generated decoder for the structural subset, identical semantics by construction (property-tested), 2.6–2.8x the interpreter on the regex-heavy bench schema, 4.0x on a flat struct and up to 4.8x without regexes (interleaved A/B, benchmarks.md); returns the decoder unchanged where `new Function` is forbidden (CSP, Cloudflare Workers).
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
- `D.array` decodes to `ReadonlyArray<A>` and `D.nonEmptyArray` to `readonly [A, ...A[]]` (type-only; immutability is a type-level property, decision 0003). Found building the proof repo: a domain type declared with a readonly tuple could not receive a decoded non-empty array.
- Decoder internals rewritten for speed with no contract change: value-or-Failure protocol (one `Result` per decode, not per field), key-passing path (no push/pop per primitive field), fused primitive refinements, inline primitive checks in `struct`/`array`, cheaper own-key check on plain objects. Interpreter 1.2–1.5x faster; selective decoder bundles grew ~1 kB (budgets updated with the reason).
- `D.isoDate` is now strict ISO-8601: `YYYY-MM-DD`, or a date-time with `Z`/`±HH:mm`; calendar-invalid dates (`2023-02-30`), times out of range, and offset-less date-times are rejected. The previous engine-grammar behaviour is available, explicitly named, as `D.dateFromString`.
- `D.oneOf` reports every alternative's issues on failure, each prefixed `alternative N:`, instead of only the last alternative's.
- `two-track-check` `no-platform-calls` also reports `performance.now()` and `crypto.getRandomValues()`; new `no-process-env` reports environment reads outside the `root` layer (the skill's boundaries reference had claimed this was enforced; now it is).
- `pnpm check` now enforces coverage per file, lane throughput ratio gates (`check:lanes`), bundle budgets (`check:bundle`), the packed-consumer check (`check:package`), and the separate checker package's full check. Both packages require 95% statements/lines/functions and 90% branches per executable file.
- `Async.mapConcurrent`, `Async.validateConcurrent` and `Async.retry` add `Aborted` to their error unions only when a `signal` is supplied; a third overload accepts options/policies typed with an optional signal and returns `E | Aborted` conservatively.
- `oneOf` skips its eager failure allocation, concurrent validation writes directly into its final success array and creates failure storage only on demand, and lane signal linking avoids temporary arrays.
- `Async.retry`: `retriable` is now required (amendment to decision 0005). Write `retriable: () => true` to retry every error explicitly.
- `Async.retry`: with a `signal`, an abort before an attempt or during a backoff wait returns `err(Aborted)` and starts no further attempt; the error type widens to `E | Aborted` only when a signal is supplied.
- `Lane.queueLane`: after a lane-level abort, waiting calls resolve `Busy` promptly (without waiting for the run in flight) and never start; the union is `E | QueueFull | Busy`.
- Packaging: `exports` gained `default` conditions and `./package.json`; declaration files no longer import `.ts` specifiers; `engines.node` is `>=20` for consumers (contributing still needs Node ≥ 22.18 for type stripping); `publishConfig` with provenance and a tag-driven release workflow.

### Fixed
- `Lane.semaphore` was quadratic on V8 with a large waiting queue (`Array.shift()` in `release`, `indexOf`/`splice` on abort): 376x the direct-call baseline at 200k waiters. The queue is now a head-index FIFO with tombstoned aborts and periodic compaction (7x). Found by the new `bench/lanes.ts`; pinned by a linear-drain test.
- `Lane.semaphore` released no permit when a run threw (a defect turned into a deadlock for every later caller); the permit is released and the rejection re-surfaces.
- `Async.mapConcurrent` left its outer-signal listener attached and let sibling workers run on when `f` rejected; siblings are now aborted, the listener removed, and the defect rejects the call.
- `Async.validateConcurrent` kept launching new items after an outer abort; it now stops launching and returns `Aborted` (the union gains `Aborted` only when a `signal` is supplied, as for `mapConcurrent`).
- `match` / `matchBy` on a tag the type forbids threw `TypeError: cases[value._tag] is not a function`; they now throw a clear defect naming the tag and the known cases.
- `two-track-check`: `ignored-result` / `floating-async-result` judge an expression statement by its type, so `r;`, `await p;` and `p;` over a stored Result or promise are reported, not only direct calls.
- Caller cancellation no longer yields an incomplete `mapConcurrent` success; pre-aborted parents propagate to concurrent maps and timeouts, and deadlines still fire if work ignores cancellation.
- Decoder `__proto__` fields remain ordinary own properties, inherited struct fields are absent, global/sticky patterns are deterministic without mutating caller regexes, and large nested issue lists no longer overflow argument limits.
- Same-turn switch bursts supersede stale successes; semaphore cancellation between permit acquisition and callback start returns Busy and restores the permit. NaN counts and fractional queue depths obey normalized bounds.
- `tagged` keeps its declared discriminant in both the returned object and its type when fields carry a conflicting tag.
- The checker rejects invalid tsconfig diagnostics, layer arrays and malformed CLI arguments; recognizes Results anywhere in a tuple; and reads suppression directives only from actual comments.
- `Async.retry` ran one extra attempt, with an already-aborted signal, when the abort happened during the backoff wait (reported downstream; see docs/exec-plans/completed/0002-downstream-findings.md).

- `prepare` scripts in both packages build `dist/` when installed from git (`pnpm add github:mikezupper/two-track`); pnpm 10 consumers allowlist them in `pnpm.onlyBuiltDependencies`. `two-track-check` declares `engines.node >=20` like the library (its bin runs built JavaScript).

### Testing
- `pnpm bench:lanes` / `pnpm check:lanes`: per-trigger overhead of every lane under immediate and waiting workloads with heap-retention figures; `--check` enforces ratio gates against a same-run baseline and is part of `pnpm check` and CI.
- `pnpm bench:cross` (workspace `bench/cross`, own dev deps): decoders versus Zod 4 / Valibot / ArkType on an identical schema with a validity-agreement assertion, and the railway versus Ramda / Effect from the built `dist/`; both run report-only in CI. The root README's "as fast as compiled validators" claim was measured, found false for valid input against ArkType, and replaced by the table.
- CLI, config/project failure paths, direct subpath imports, negative architecture invariants, large nested decoding and cancellation race regressions; HTML and JSON coverage reports for both packages.
- Model-based fast-check properties for `async`, `lanes` and `capabilities` (event sequences over `manualSleeper`/`controlledClock`, leak checks); enforced per export by the invariants script.
- `pnpm check:package`: packs the tarball, installs it, and verifies import/require/`package.json` and `tsc` with `skipLibCheck: false` under TypeScript 6 and 7.
