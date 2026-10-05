# 0009 — Lanes: trigger coordination over time, distinct from collection fan-out

Status: accepted        Date: 2026-10-05

## Context

`Async.mapConcurrent` answers "I have a finite collection; run it with at most N in flight." A different question arrives from UIs, HTTP handlers, webhooks and pollers: "a new trigger arrived while a previous operation is still running — what happens to the old one?" That is the RxJS `switchMap` / `exhaustMap` / `concatMap` family. Without library support, every project reinvents it with a stray `AbortController` and a boolean flag, usually wrong.

## Decision

`src/lanes.ts` (`Lane` namespace) provides the trigger-coordination primitives as stateful closures over the primitives the library already has: `switchLane` (newest wins; superseded calls resolve `err(Superseded)` immediately), `exhaustLane` (busy calls resolve `err(Busy)` without starting), `queueLane` (strict arrival order, bounded `depth`, `err(QueueFull)` beyond it), `debounce` (trailing edge, via `Sleeper`), `throttle` (leading edge, via `Clock`), and `semaphore(permits)` (bounded concurrency for callers that have neither a list nor a trigger). All take and thread `AbortSignal`s and accept a lane-level `signal` that aborts everything. The new failure modes are tagged errors in the returned union, so a handler must decide what `Superseded`/`Busy`/`QueueFull` mean for it.

## Evidence

- The three failure modes are not exceptional: a superseded search, a double-clicked save, and a full queue are normal outcomes the UI must render. Putting them on the typed error track is what the railway is for.
- Each lane is 25–45 lines of contained state. Timing goes through `Sleeper`/`Clock`, so `Cap.manualSleeper()` and `Cap.controlledClock()` make the tests deterministic with no real timers.
- Peak concurrency, FIFO order and abort propagation are asserted by tests, the same bar as `mapConcurrent`.

## Alternatives

- **An observable/stream type** — rejected: a runtime, a second composition model, and the error track would move into stream semantics.
- **Leave it to user code** — rejected: the switch pattern in particular is subtle (the superseded promise must settle even if its run ignores the signal), and getting it wrong leaks requests.

## Consequences

- Lanes live in the shell (UI event handlers, HTTP adapters), never in `domain/`; the skill's decision table says so.
- `Lane.semaphore` is the public form of what `mapConcurrent` does internally.
- `Cap.manualSleeper` joins the deterministic capabilities.
