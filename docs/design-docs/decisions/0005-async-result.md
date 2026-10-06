# 0005 — AsyncResult is an eager Promise<Result> that never rejects

Status: accepted        Date: 2026-10-05

## Context

Asynchronous railways can be a lazy `Task`/`Future` type (Fluture, fp-ts `TaskEither`, Effect) or an eager promise of a Result (neverthrow `ResultAsync` is a thin wrapper over the latter). Laziness gives retry and cancellation semantics for free; eagerness interoperates with everything.

## Decision

`AsyncResult<E, A> = Promise<Result<E, A>>`, no wrapper type. The railway rule: a promise on the railway never rejects; rejection is reserved for defects. `Async.fromPromise` and `Async.tryPromise` are the conversion points from the rejecting world. Every long-running combinator (`mapConcurrent`, `retry`, `withTimeout`, `tryPromise`) accepts and threads an `AbortSignal`, and `mapConcurrent` aborts in-flight work on the first failure.

## Evidence

- `await` compiles to the engine's native promise machinery and costs far less than a generator-driven interpreter (see 0002's numbers).
- Every HTTP client, driver, and framework already returns promises; a lazy type would need `run` at every edge.
- Cancellation via `AbortSignal` is the web-standard mechanism and is honoured by `fetch`, timers, and most drivers.

## Alternatives

- **Lazy `Task`** — rejected for interop and runtime cost; retry is instead a function that takes a thunk.
- **A `ResultAsync` wrapper class with methods** — rejected per 0001 (classes) and because it hides the promise from `Promise.all`/`race`.

## Amendment (2026-10-05)

`RetryPolicy.retriable` is **required**. The original optional field defaulted to "retry everything", which is the classic foot-gun of retrying a validation error five times. Callers that genuinely want to retry every error write `retriable: () => true` and thereby say so.

## Amendment (2026-10-05, downstream finding 1)

`retry` checks its `signal` before every attempt **and after every backoff sleep** (sleepers resolve, not reject, on abort, so the previous after-sleep fall-through ran one extra attempt). On abort it returns `err(Aborted)`; the error type is `E | Aborted` only for policies that pass a `signal`, so uncancellable call sites are unchanged.

## Amendment (2026-10-05, full project review)

`mapConcurrent` starts no work for an already-aborted parent and returns `Aborted` after caller cancellation, rather than reporting a success array with missing items. The first operation error still takes precedence. Its overloads add cancellation only where a signal can be present. Both it and `retry` accept policies/options typed with an optional signal. `withTimeout` propagates an already-aborted parent and resolves its deadline independently of abort events, so a run that ignores cancellation still reaches the deadline. Numeric counts normalize NaN to one, matching the existing minimum-one behavior.

See [review regressions](../../../test/async.properties.test.ts) for generated cancellation cases and the deterministic deadline regression.

## Amendment (2026-10-05, follow-up)

`validateConcurrent` follows `mapConcurrent`: an already-aborted or later-aborted caller signal stops new items from starting and yields `Aborted`; the union widens only when a `signal` is passed. A rejecting `f` in `mapConcurrent` is still a defect, but it now aborts sibling workers and removes the outer listener before rejecting, so a defect cannot leak.

## Consequences

- `no-catch-method` invariant; `.then(ok, onRejected)` is the internal idiom.
- `Async.retry`, `withTimeout` take a `Sleeper` / use `setTimeout` (the one documented timer outside `capabilities.ts`).
- Tests cover: never-rejects, peak concurrency, fail-fast abort, outer-signal propagation, timeout vs parent-abort.
