/**
 * Lanes — trigger coordination over time.
 *
 * `Async.mapConcurrent` answers "I have a finite collection; fan it out with at
 * most N in flight". Lanes answer the other question: "a new trigger arrived
 * while a previous call is still running — what happens to the old one?"
 * Search-as-you-type (switch), a save button clicked twice (exhaust), webhooks
 * that must be processed in order (queue), a noisy sensor (debounce/throttle),
 * and a shared scarce resource (semaphore).
 *
 * Decision 0009 — lanes are trigger coordination over time, not collection
 * fan-out. They are stateful closures owned by the shell (UI event, HTTP
 * handler), never by the domain. Every rejected call is a tagged value on the
 * error track; nothing here throws, and nothing here touches a timer directly:
 * time comes from the `Sleeper` and `Clock` capabilities.
 */

import type { AsyncResult } from "./async.ts";
import type { Clock, Sleeper } from "./capabilities.ts";
import type { Result } from "./result.ts";
import { err } from "./result.ts";
import { tagged } from "./tagged.ts";

/** A newer trigger replaced this call before it could produce a result. */
export const Superseded = tagged("Superseded")();
/** Rejected without starting: a call is in flight, the window is closed, or the wait was aborted. */
export const Busy = tagged("Busy")();
/** Rejected without starting: the queue already holds `depth` waiting calls. */
export const QueueFull = tagged("QueueFull")<{ depth: number }>();
export type Superseded = ReturnType<typeof Superseded>;
export type Busy = ReturnType<typeof Busy>;
export type QueueFull = ReturnType<typeof QueueFull>;

/** Shared instances: a rejected call allocates nothing. */
const SUPERSEDED: Result<Superseded, never> = err(Superseded({}));
const BUSY: Result<Busy, never> = err(Busy({}));

export type LaneOptions = {
  /** Lane-level abort: delivered to every in-flight run and every pending wait. */
  readonly signal?: AbortSignal;
};

type Run<Args extends ReadonlyArray<unknown>, E, A> = (signal: AbortSignal, ...args: Args) => AsyncResult<E, A>;

type Linked = { readonly controller: AbortController; readonly unlink: () => void };

/** A controller that aborts when any of the given signals aborts; `unlink` removes the listeners. */
const linked = (...signals: ReadonlyArray<AbortSignal | undefined>): Linked => {
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  const attached: AbortSignal[] = [];
  for (let i = 0; i < signals.length; i++) {
    const s = signals[i];
    if (s === undefined) continue;
    if (s.aborted) {
      controller.abort();
      continue;
    }
    s.addEventListener("abort", onAbort, { once: true });
    attached.push(s);
  }
  return {
    controller,
    unlink: () => {
      for (let i = 0; i < attached.length; i++) (attached[i] as AbortSignal).removeEventListener("abort", onAbort);
    },
  };
};

/**
 * switch: each new call aborts the previous in-flight call. The superseded
 * call's promise resolves `err(Superseded)` immediately — even if its run
 * ignores the signal — so callers never wait on stale work. Only the latest
 * call can return `ok`. A lane-level abort supersedes the current call.
 */
export const switchLane = <Args extends ReadonlyArray<unknown>, E, A>(
  run: Run<Args, E, A>,
  options: LaneOptions = {},
): ((...args: Args) => AsyncResult<E | Superseded, A>) => {
  let current: AbortController | undefined;
  return async (...args) => {
    current?.abort();
    const { controller, unlink } = linked(options.signal);
    current = controller;
    if (controller.signal.aborted) {
      unlink();
      return SUPERSEDED;
    }
    const superseded = new Promise<Result<Superseded, never>>((resolve) => {
      controller.signal.addEventListener("abort", () => resolve(SUPERSEDED), { once: true });
    });
    const result = await Promise.race([run(controller.signal, ...args), superseded]);
    unlink();
    if (current === controller) current = undefined;
    return result;
  };
};

/**
 * exhaust: while a call is in flight, further calls return `err(Busy)` at once
 * without starting work. The in-flight run observes a lane-level abort through
 * its signal; its own result is returned unchanged.
 */
export const exhaustLane = <Args extends ReadonlyArray<unknown>, E, A>(
  run: Run<Args, E, A>,
  options: LaneOptions = {},
): ((...args: Args) => AsyncResult<E | Busy, A>) => {
  let inFlight = false;
  return async (...args) => {
    if (inFlight) return BUSY;
    const { controller, unlink } = linked(options.signal);
    if (controller.signal.aborted) {
      unlink();
      return BUSY;
    }
    inFlight = true;
    const result = await run(controller.signal, ...args);
    inFlight = false;
    unlink();
    return result;
  };
};

/**
 * queue (concat): calls run strictly one after another in arrival order. At
 * most `depth` calls may wait behind the running one (default: unbounded);
 * beyond that the call is rejected with `err(QueueFull)` without being queued.
 * A failing run does not stop the calls behind it. A lane-level abort is
 * delivered through the signal: queued runs still start, with an already
 * aborted signal, and are expected to return promptly.
 */
export const queueLane = <Args extends ReadonlyArray<unknown>, E, A>(
  run: Run<Args, E, A>,
  options: LaneOptions & { readonly depth?: number } = {},
): ((...args: Args) => AsyncResult<E | QueueFull | Busy, A>) => {
  const depth = options.depth ?? Number.POSITIVE_INFINITY;
  let tail: Promise<unknown> = Promise.resolve();
  let active = 0;
  let pending = 0;
  return (...args) => {
    // A lane-level abort rejects new calls and every call still waiting with Busy
    // (the same meaning as a semaphore waiter aborted before acquiring). The run
    // in flight, if any, sees the abort through its signal and finishes itself.
    if (options.signal?.aborted === true) return Promise.resolve(BUSY);
    // When idle, the first pending call is the one about to run, not a waiter.
    const waiting = active > 0 ? pending : Math.max(0, pending - 1);
    if (active + pending > 0 && waiting >= depth) return Promise.resolve(err(QueueFull({ depth })));
    pending++;
    let started = false;
    const next = tail.then(async (): Promise<Result<E | QueueFull | Busy, A>> => {
      pending--;
      if (options.signal?.aborted === true) return BUSY;
      started = true;
      active++;
      const { controller, unlink } = linked(options.signal);
      const result = await run(controller.signal, ...args);
      unlink();
      active--;
      return result;
    });
    tail = next;
    const lane = options.signal;
    if (lane === undefined) return next;
    // A WAITING call must learn about a lane abort promptly — not once the run ahead of
    // it happens to finish. Race the queue slot against the abort while the call has not
    // started; the slot itself still yields BUSY when its turn comes, so nothing starts.
    // A call whose run already started returns that run's own result. The listener is
    // removed either way.
    return new Promise<Result<E | QueueFull | Busy, A>>((resolve) => {
      const onAbort = (): void => {
        if (!started) resolve(BUSY);
      };
      lane.addEventListener("abort", onAbort, { once: true });
      void next.then((r) => {
        lane.removeEventListener("abort", onAbort);
        resolve(r);
      });
    });
  };
};

/**
 * debounce (trailing edge): a call starts only after `ms` of quiet. Every
 * earlier call in the burst resolves `err(Superseded)`. The wait goes through
 * `deps.sleeper`, so tests drive it with `Cap.manualSleeper()`. Once a run has
 * started it is not cancelled by later calls; they begin a new quiet period.
 */
export const debounce = <Args extends ReadonlyArray<unknown>, E, A>(
  run: Run<Args, E, A>,
  ms: number,
  deps: { readonly sleeper: Sleeper } & LaneOptions,
): ((...args: Args) => AsyncResult<E | Superseded, A>) => {
  let waiting: AbortController | undefined;
  return async (...args) => {
    waiting?.abort();
    const { controller, unlink } = linked(deps.signal);
    waiting = controller;
    await deps.sleeper.sleep(ms, controller.signal);
    if (controller.signal.aborted) {
      unlink();
      return SUPERSEDED;
    }
    if (waiting === controller) waiting = undefined;
    const result = await run(controller.signal, ...args);
    unlink();
    return result;
  };
};

/**
 * throttle (leading edge): the first call starts immediately; calls arriving
 * within `ms` of that start (measured by `deps.clock`) return `err(Busy)`
 * without starting work. The window is measured from the start of the last
 * accepted call, not its end.
 */
export const throttle = <Args extends ReadonlyArray<unknown>, E, A>(
  run: Run<Args, E, A>,
  ms: number,
  deps: { readonly clock: Clock } & LaneOptions,
): ((...args: Args) => AsyncResult<E | Busy, A>) => {
  let windowStart: number | undefined;
  return async (...args) => {
    const now = deps.clock.now();
    if (windowStart !== undefined && now - windowStart < ms) return BUSY;
    const { controller, unlink } = linked(deps.signal);
    if (controller.signal.aborted) {
      unlink();
      return BUSY;
    }
    windowStart = now;
    const result = await run(controller.signal, ...args);
    unlink();
    return result;
  };
};

export type Semaphore = {
  /** Run `f` once a permit is free. A waiter whose signal aborts before acquiring resolves `err(Busy)`. */
  readonly run: <E, A>(f: (signal: AbortSignal) => AsyncResult<E, A>, signal?: AbortSignal) => AsyncResult<E | Busy, A>;
  /** Free permits right now. */
  readonly available: () => number;
};

/**
 * semaphore: at most `permits` concurrent runs; the rest wait in FIFO order.
 * This is the primitive under `Async.mapConcurrent`, exposed for the cases
 * where the callers are not a list — N request handlers sharing one
 * connection pool, for instance.
 */
export const semaphore = (permits: number, options: LaneOptions = {}): Semaphore => {
  let free = Math.max(1, Math.floor(permits));
  const waiters: Array<() => void> = [];

  const acquire = (signal: AbortSignal): Promise<boolean> => {
    if (signal.aborted) return Promise.resolve(false);
    if (free > 0) {
      free--;
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      const grant = (): void => {
        signal.removeEventListener("abort", onAbort);
        free--;
        resolve(true);
      };
      const onAbort = (): void => {
        const i = waiters.indexOf(grant);
        if (i >= 0) waiters.splice(i, 1);
        resolve(false);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      waiters.push(grant);
    });
  };

  const release = (): void => {
    free++;
    const next = waiters.shift();
    if (next !== undefined) next();
  };

  return {
    available: () => free,
    run: async (f, signal) => {
      const { controller, unlink } = linked(signal, options.signal);
      const granted = await acquire(controller.signal);
      if (!granted) {
        unlink();
        return BUSY;
      }
      const result = await f(controller.signal);
      release();
      unlink();
      return result;
    },
  };
};
