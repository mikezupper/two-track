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

## Amendment (2026-10-05, downstream finding 2b)

After a lane-level abort, `queueLane` resolves every call still waiting as `err(Busy)` without starting it, and rejects new calls as `Busy`, the same meaning a `semaphore` waiter gets. The run in flight finishes on its own after seeing the abort. The returned union is `E | QueueFull | Busy`.

## Amendment (2026-10-05, full project review)

Same-turn switch bursts supersede earlier calls even when their runs resolved immediately, before promise continuations execute. A semaphore checks cancellation again after acquiring a permit and before starting the callback, returning Busy and releasing the permit if cancelled in that gap. Counts normalize NaN and fractional queue depths consistently with their documented bounds. Linked signals retain independent controllers while avoiding temporary arrays. Regression and schedule tests verify FIFO, bounds, cancellation and cleanup.

## Amendment (2026-10-05, follow-up)

A `semaphore` run that throws releases its permit before the rejection re-surfaces: a defect in one caller must not become a deadlock for the next.

## Amendment (2026-10-05, measured throughput)

`bench/lanes.ts` measures every lane against a same-run direct-call baseline. It found the `semaphore` waiter queue quadratic on V8 (`shift`/`indexOf`), now a head-index FIFO with tombstoned aborts (376x → 7x). It also quantified the price of `switchLane`/`debounce` semantics at ~10 µs per trigger on V8, which the README now states so these lanes are used for user-rate triggers and not inside per-row loops. The gates (immediate ≤ 75x, waiting ≤ 100x) run in `pnpm check` and CI.

## Consequences

- Lanes live in the shell (UI event handlers, HTTP adapters), never in `domain/`; the skill's decision table says so.
- `Lane.semaphore` is the public form of what `mapConcurrent` does internally.
- `Cap.manualSleeper` joins the deterministic capabilities.
