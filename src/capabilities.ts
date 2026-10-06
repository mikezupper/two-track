/**
 * Capabilities — the effects a workflow is allowed to perform, as values.
 *
 * Domain code never calls `Date.now()`, `performance.now()`, `Math.random()`,
 * `crypto.randomUUID()`, `crypto.getRandomValues()` or `setTimeout` directly. It receives a capability record and calls that.
 * Production wires the `system*` implementations in one composition root;
 * tests wire the deterministic ones. This is the zero-runtime stand-in for
 * Effect's requirements channel and Rust's trait objects.
 */

export interface Clock {
  /** Milliseconds since the Unix epoch. */
  readonly now: () => number;
}

export interface Sleeper {
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface Random {
  /** Uniform in [0, 1). */
  readonly next: () => number;
}

export interface IdGen {
  readonly next: () => string;
}

// ---------- production implementations ----------

export const systemClock: Clock = { now: () => Date.now() };

export const systemSleeper: Sleeper = {
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      if (signal?.aborted) return resolve();
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = (): void => {
        clearTimeout(timer);
        resolve();
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    }),
};

export const systemRandom: Random = { next: () => Math.random() };

export const systemIdGen: IdGen = { next: () => globalThis.crypto.randomUUID() };

// ---------- deterministic implementations for tests ----------

/** A clock that only moves when you tell it to. */
export const controlledClock = (start = 0): Clock & { readonly advance: (ms: number) => void; readonly set: (ms: number) => void } => {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
    set: (ms) => {
      current = ms;
    },
  };
};

/** A sleeper that never waits but records every requested delay. */
export const instantSleeper = (): Sleeper & { readonly calls: ReadonlyArray<number> } => {
  const calls: number[] = [];
  return {
    calls,
    sleep: (ms) => {
      calls.push(ms);
      return Promise.resolve();
    },
  };
};

type ManualTimer = { readonly ms: number; readonly resolve: () => void; readonly signal: AbortSignal | undefined; readonly onAbort: () => void };

/**
 * A sleeper whose timers only fire when the test says so. `pending()` lists
 * outstanding delays in call order; `fire(index = 0)` resolves one;
 * `fireAll()` resolves all. Aborting a signal passed to `sleep` resolves that
 * sleep immediately and removes it from `pending()`. Drives `Lane.debounce`
 * and any retry loop deterministically.
 */
export const manualSleeper = (): Sleeper & {
  readonly pending: () => ReadonlyArray<number>;
  readonly fire: (index?: number) => void;
  readonly fireAll: () => void;
} => {
  const timers: ManualTimer[] = [];
  const remove = (timer: ManualTimer): void => {
    const i = timers.indexOf(timer);
    if (i >= 0) timers.splice(i, 1);
  };
  const fire = (index = 0): void => {
    const timer = timers[index];
    if (timer === undefined) return;
    remove(timer);
    timer.signal?.removeEventListener("abort", timer.onAbort);
    timer.resolve();
  };
  return {
    pending: () => timers.map((t) => t.ms),
    fire,
    fireAll: () => {
      while (timers.length > 0) fire(0);
    },
    sleep: (ms, signal) =>
      new Promise((resolve) => {
        if (signal?.aborted) return resolve();
        const timer: ManualTimer = {
          ms,
          resolve,
          signal,
          onAbort: () => {
            remove(timer);
            resolve();
          },
        };
        signal?.addEventListener("abort", timer.onAbort, { once: true });
        timers.push(timer);
      }),
  };
};

/** Mulberry32: a small, fast, seedable PRNG. Same seed, same sequence, every run. */
export const seededRandom = (seed: number): Random => {
  let state = seed >>> 0;
  return {
    next: () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
};

export const sequentialIds = (prefix = "id-"): IdGen => {
  let n = 0;
  return { next: () => `${prefix}${++n}` };
};
