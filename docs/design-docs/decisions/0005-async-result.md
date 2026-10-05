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

## Consequences

- `no-catch-method` invariant; `.then(ok, onRejected)` is the internal idiom.
- `Async.retry`, `withTimeout` take a `Sleeper` / use `setTimeout` (the one documented timer outside `capabilities.ts`).
- Tests cover: never-rejects, peak concurrency, fail-fast abort, outer-signal propagation, timeout vs parent-abort.
