/**
 * The asynchronous railway: `AsyncResult<E, A>` is simply `Promise<Result<E, A>>`.
 *
 * Decisions (docs/design-docs/decisions/0005-async-result.md):
 * - Eager promises, not a lazy Task type: interoperates with every library,
 *   and `await` is free of the generator cost that do-notation pays.
 * - A promise on the railway NEVER rejects. Rejection is reserved for defects.
 *   `fromPromise`/`tryPromise` are the only places `.catch` appears.
 * - Every long-running combinator threads an AbortSignal so timeouts and
 *   first-failure cancellation actually stop work.
 */

import type { Sleeper } from "./capabilities.ts";
import { systemSleeper } from "./capabilities.ts";
import type { NonEmptyArray, Result } from "./result.ts";
import { err, ok } from "./result.ts";

export type AsyncResult<E, A> = Promise<Result<E, A>>;

/** Interop edge: a promise that may reject → a promise that never rejects. */
export const fromPromise = <E, A>(promise: Promise<A>, onReject: (thrown: unknown) => E): AsyncResult<E, A> =>
  promise.then(ok, (thrown: unknown) => err(onReject(thrown)));

/** Interop edge with cancellation: the thunk receives a signal to pass to fetch/drivers. */
export const tryPromise = <E, A>(
  thunk: (signal: AbortSignal) => Promise<A>,
  onReject: (thrown: unknown) => E,
  signal: AbortSignal = new AbortController().signal,
): AsyncResult<E, A> => {
  // A thunk that throws synchronously is still a rejection from the railway's point of view.
  try {
    return thunk(signal).then(ok, (thrown: unknown) => err(onReject(thrown)));
  } catch (thrown) {
    return Promise.resolve(err(onReject(thrown)));
  }
};

export const map = async <E, A, B>(ar: AsyncResult<E, A>, f: (a: A) => B): AsyncResult<E, B> => {
  const r = await ar;
  return r.ok ? ok(f(r.value)) : r;
};

export const mapErr = async <E, A, E2>(ar: AsyncResult<E, A>, f: (e: E) => E2): AsyncResult<E2, A> => {
  const r = await ar;
  return r.ok ? r : err(f(r.error));
};

/** The async railway switch. The next step may be sync or async. */
export const andThen = async <E, A, E2, B>(
  ar: AsyncResult<E, A> | Result<E, A>,
  f: (a: A) => AsyncResult<E2, B> | Result<E2, B>,
): AsyncResult<E | E2, B> => {
  const r = await ar;
  return r.ok ? f(r.value) : r;
};

export const orElse = async <E, A, E2, B>(
  ar: AsyncResult<E, A>,
  f: (e: E) => AsyncResult<E2, B> | Result<E2, B>,
): AsyncResult<E2, A | B> => {
  const r = await ar;
  return r.ok ? r : f(r.error);
};

export const match = async <E, A, B>(ar: AsyncResult<E, A>, onOk: (a: A) => B, onErr: (e: E) => B): Promise<B> => {
  const r = await ar;
  return r.ok ? onOk(r.value) : onErr(r.error);
};

export const tap = async <E, A>(ar: AsyncResult<E, A>, f: (a: A) => void | Promise<void>): AsyncResult<E, A> => {
  const r = await ar;
  if (r.ok) await f(r.value);
  return r;
};

export const tapErr = async <E, A>(ar: AsyncResult<E, A>, f: (e: E) => void | Promise<void>): AsyncResult<E, A> => {
  const r = await ar;
  if (!r.ok) await f(r.error);
  return r;
};

export type ConcurrencyOptions = {
  /** Maximum in-flight tasks. Required: unbounded fan-out is the #1 way to take down a dependency. */
  readonly concurrency: number;
  readonly signal?: AbortSignal;
};

/**
 * Apply an async fallible function to every item with bounded concurrency.
 * Fail-fast: on the first error no new work starts and in-flight work is
 * signalled to abort; the first error is returned. Results keep input order.
 */
export const mapConcurrent = async <E, A, B>(
  items: ReadonlyArray<A>,
  f: (item: A, index: number, signal: AbortSignal) => AsyncResult<E, B> | Result<E, B>,
  options: ConcurrencyOptions,
): AsyncResult<E, B[]> => {
  const limit = Math.max(1, Math.floor(options.concurrency));
  const controller = new AbortController();
  const onOuterAbort = (): void => controller.abort();
  options.signal?.addEventListener("abort", onOuterAbort, { once: true });
  const out = new Array<B>(items.length);
  let next = 0;
  let failure: Result<E, never> | undefined;

  const worker = async (): Promise<void> => {
    while (failure === undefined && !controller.signal.aborted && next < items.length) {
      const index = next++;
      const r = await f(items[index] as A, index, controller.signal);
      if (r.ok) out[index] = r.value;
      else if (failure === undefined) {
        failure = r;
        controller.abort();
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  options.signal?.removeEventListener("abort", onOuterAbort);
  return failure ?? ok(out);
};

/**
 * Like `mapConcurrent` but never stops early: runs everything and reports
 * all errors (or all values). Use for batch jobs and input validation.
 */
export const validateConcurrent = async <E, A, B>(
  items: ReadonlyArray<A>,
  f: (item: A, index: number, signal: AbortSignal) => AsyncResult<E, B> | Result<E, B>,
  options: ConcurrencyOptions,
): AsyncResult<NonEmptyArray<E>, B[]> => {
  const limit = Math.max(1, Math.floor(options.concurrency));
  const signal = options.signal ?? new AbortController().signal;
  const results = new Array<Result<E, B>>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await f(items[index] as A, index, signal);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  const values: B[] = [];
  const errors: E[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i] as Result<E, B>;
    if (r.ok) values.push(r.value);
    else errors.push(r.error);
  }
  return errors.length === 0 ? ok(values) : err(errors as unknown as NonEmptyArray<E>);
};

/** Sequence promises of Results (already started). First error wins; order preserved. */
export const all = async <E, A>(promises: ReadonlyArray<AsyncResult<E, A>>): AsyncResult<E, A[]> => {
  const results = await Promise.all(promises);
  const out = new Array<A>(results.length);
  for (let i = 0; i < results.length; i++) {
    const r = results[i] as Result<E, A>;
    if (!r.ok) return r;
    out[i] = r.value;
  }
  return ok(out);
};

export type RetryPolicy<E> = {
  /** Total attempts including the first. */
  readonly attempts: number;
  /** Delay before attempt n (1-based retry index). Use `backoff(...)`. */
  readonly delay: (retry: number) => number;
  /** Only retry what is actually transient. Defaults to retrying everything. */
  readonly retriable?: (error: E) => boolean;
  readonly sleeper?: Sleeper;
  readonly signal?: AbortSignal;
};

/** Retry a fallible async operation under a policy. The last error is returned. */
export const retry = async <E, A>(
  run: (attempt: number, signal: AbortSignal) => AsyncResult<E, A> | Result<E, A>,
  policy: RetryPolicy<E>,
): AsyncResult<E, A> => {
  const sleeper = policy.sleeper ?? systemSleeper;
  const signal = policy.signal ?? new AbortController().signal;
  const attempts = Math.max(1, Math.floor(policy.attempts));
  let last: Result<E, A> | undefined;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    last = await run(attempt, signal);
    if (last.ok) return last;
    if (attempt === attempts || signal.aborted) break;
    if (policy.retriable !== undefined && !policy.retriable(last.error)) break;
    await sleeper.sleep(policy.delay(attempt), signal);
  }
  return last as Result<E, A>;
};

export type BackoffOptions = {
  readonly baseMs: number;
  readonly factor?: number;
  readonly maxMs?: number;
  /** Jitter source in [0, 1); inject a seeded Random in tests. */
  readonly random?: () => number;
};

/** Exponential backoff with full jitter: delay(n) = random() * min(max, base * factor^(n-1)). */
export const backoff =
  ({ baseMs, factor = 2, maxMs = Number.POSITIVE_INFINITY, random }: BackoffOptions) =>
  (retry: number): number => {
    const cap = Math.min(maxMs, baseMs * factor ** (retry - 1));
    return random === undefined ? cap : Math.floor(random() * cap);
  };

/**
 * Impose a deadline. The operation receives a signal that fires at the deadline;
 * whether work actually stops depends on the operation honouring it.
 */
export const withTimeout = async <E, A, E2>(
  run: (signal: AbortSignal) => AsyncResult<E, A>,
  ms: number,
  onTimeout: () => E2,
  parent?: AbortSignal,
): AsyncResult<E | E2, A> => {
  const controller = new AbortController();
  const onParentAbort = (): void => controller.abort();
  parent?.addEventListener("abort", onParentAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  const deadline = new Promise<Result<E2, never>>((resolve) => {
    controller.signal.addEventListener("abort", () => {
      if (timedOut) resolve(err(onTimeout()));
    }, { once: true });
  });
  try {
    return await Promise.race([run(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", onParentAbort);
  }
};
