/**
 * Deterministic scheduling harness for property tests over time-dependent code.
 * No real timers: time is `Cap.manualSleeper` / `Cap.controlledClock`, and
 * `tick()` only flushes microtasks. Failures print a replayable seed; set
 * FC_SEED / FC_RUNS to replay or scale.
 */
import fc from "fast-check";
import type { Result } from "../../src/index.ts";

export type Deferred<T> = { readonly promise: Promise<T>; readonly resolve: (value: T) => void };
export const deferred = <T>(): Deferred<T> => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

/** Flush the microtask queue deeply enough for chained awaits to settle. */
export const tick = async (depth = 12): Promise<void> => {
  for (let i = 0; i < depth; i++) await Promise.resolve();
};

/** fast-check parameters with seed/runs overridable from the environment and verbose counter-examples. */
export const fcParams = (overrides: { readonly numRuns?: number } = {}): fc.Parameters<unknown> => {
  const seed = process.env["FC_SEED"];
  const runs = process.env["FC_RUNS"];
  const base: fc.Parameters<unknown> = { numRuns: runs !== undefined ? Number(runs) : (overrides.numRuns ?? 60), verbose: true };
  return seed !== undefined ? { ...base, seed: Number(seed) } : base;
};

/** An AbortSignal whose listener registrations are observable, so leaks are testable. */
export type CountingSignal = {
  readonly signal: AbortSignal;
  readonly abort: () => void;
  readonly listeners: () => number;
};
export const countingSignal = (): CountingSignal => {
  const controller = new AbortController();
  const signal = controller.signal;
  const live = new Map<EventListenerOrEventListenerObject, boolean>();
  const target = signal as unknown as {
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => void;
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) => void;
  };
  const add = target.addEventListener.bind(signal);
  const remove = target.removeEventListener.bind(signal);
  target.addEventListener = (type, listener, options) => {
    if (listener !== null) live.set(listener, typeof options === "object" && options.once === true);
    add(type, listener, options);
  };
  target.removeEventListener = (type, listener, options) => {
    if (listener !== null) live.delete(listener);
    remove(type, listener, options);
  };
  return {
    signal,
    abort: () => {
      controller.abort();
      for (const [l, once] of live) if (once) live.delete(l); // the platform drops `once` listeners when they fire
    },
    listeners: () => live.size,
  };
};

/** Records every run a lane/combinator starts, and lets the test settle them in any order. */
export type TrackedRun<E, A> = {
  readonly id: number;
  readonly args: ReadonlyArray<unknown>;
  readonly signal: AbortSignal;
  readonly d: Deferred<Result<E, A>>;
  settled: boolean;
};
export type Tracker<E, A> = {
  readonly runs: TrackedRun<E, A>[];
  readonly run: (signal: AbortSignal, ...args: unknown[]) => Promise<Result<E, A>>;
  readonly unsettled: () => TrackedRun<E, A>[];
  readonly inFlight: () => number;
  readonly settle: (run: TrackedRun<E, A>, result: Result<E, A>) => void;
  readonly settleAll: (result: (run: TrackedRun<E, A>) => Result<E, A>) => void;
};
export const tracker = <E, A>(): Tracker<E, A> => {
  const runs: TrackedRun<E, A>[] = [];
  let peak = 0;
  const t: Tracker<E, A> = {
    runs,
    run: (signal, ...args) => {
      const r: TrackedRun<E, A> = { id: runs.length, args, signal, d: deferred(), settled: false };
      runs.push(r);
      peak = Math.max(peak, t.inFlight());
      return r.d.promise;
    },
    unsettled: () => runs.filter((r) => !r.settled),
    inFlight: () => runs.filter((r) => !r.settled).length,
    settle: (run, result) => {
      if (run.settled) return;
      run.settled = true;
      run.d.resolve(result);
    },
    settleAll: (result) => {
      for (const r of runs) t.settle(r, result(r));
    },
  };
  return t;
};

/** Observe when a promise settles without awaiting it. */
export type Observed<T> = { readonly promise: Promise<T>; settled: boolean; value: T | undefined };
export const observe = <T>(promise: Promise<T>): Observed<T> => {
  const o: Observed<T> = { promise, settled: false, value: undefined };
  void promise.then((v) => {
    o.settled = true;
    o.value = v;
  });
  return o;
};

/** Abstract events; indices are taken modulo the current candidates, so every sequence is valid. */
export type Event =
  | { readonly kind: "call" }
  | { readonly kind: "ok"; readonly i: number }
  | { readonly kind: "err"; readonly i: number }
  | { readonly kind: "fire"; readonly i: number }
  | { readonly kind: "advance"; readonly ms: number }
  | { readonly kind: "abortLane" }
  | { readonly kind: "abortCall"; readonly i: number };
export type EventKind = Event["kind"];

export const arbEvents = (kinds: ReadonlyArray<EventKind>, maxLength = 14): fc.Arbitrary<Event[]> => {
  const byKind: Record<EventKind, fc.Arbitrary<Event>> = {
    call: fc.constant({ kind: "call" }),
    ok: fc.nat({ max: 7 }).map((i) => ({ kind: "ok", i })),
    err: fc.nat({ max: 7 }).map((i) => ({ kind: "err", i })),
    fire: fc.nat({ max: 7 }).map((i) => ({ kind: "fire", i })),
    advance: fc.integer({ min: 0, max: 12 }).map((ms) => ({ kind: "advance", ms })),
    abortLane: fc.constant({ kind: "abortLane" }),
    abortCall: fc.nat({ max: 7 }).map((i) => ({ kind: "abortCall", i })),
  };
  return fc.array(fc.oneof(...kinds.map((k) => byKind[k])), { maxLength });
};

/** Pick the i-th (mod n) element, or undefined when empty. */
export const pick = <T>(items: ReadonlyArray<T>, i: number): T | undefined => (items.length === 0 ? undefined : items[i % items.length]);
