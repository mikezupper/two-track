/**
 * Result — the two-track type.
 *
 * Encoding decisions (see docs/design-docs/decisions/0001-result-encoding.md):
 * - boolean `ok` discriminant, two literal object shapes, no class, no methods
 * - data-first functions, no closures allocated on the hot path
 * - no generator do-notation (0002), no Object.freeze (0003)
 *
 * Every function here is total and pure. The single try/catch in this file
 * (`fromThrowable`) is the interop edge where thrown exceptions are converted
 * into values; application code never writes try/catch itself.
 */

export type Ok<A> = { readonly ok: true; readonly value: A };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<E, A> = Ok<A> | Err<E>;

/** The success type carried by a Result. */
export type OkOf<R> = R extends Ok<infer A> ? A : never;
/** The error type carried by a Result. */
export type ErrOf<R> = R extends Err<infer E> ? E : never;

/** A non-empty readonly array; used by error-accumulating combinators. */
export type NonEmptyArray<A> = readonly [A, ...A[]];

export const ok = <A>(value: A): Ok<A> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

/** A shared success-with-no-value. No allocation on the common path. */
export const unit: Ok<undefined> = ok(undefined);

export const isOk = <E, A>(r: Result<E, A>): r is Ok<A> => r.ok;
export const isErr = <E, A>(r: Result<E, A>): r is Err<E> => !r.ok;

/** Transform the success value; errors pass through untouched (functor map). */
export const map = <E, A, B>(r: Result<E, A>, f: (a: A) => B): Result<E, B> =>
  r.ok ? ok(f(r.value)) : r;

/** Transform the error; successes pass through untouched. */
export const mapErr = <E, A, E2>(r: Result<E, A>, f: (e: E) => E2): Result<E2, A> =>
  r.ok ? r : err(f(r.error));

/** Transform both tracks at once (bimap). */
export const mapBoth = <E, A, E2, B>(
  r: Result<E, A>,
  onErr: (e: E) => E2,
  onOk: (a: A) => B,
): Result<E2, B> => (r.ok ? ok(onOk(r.value)) : err(onErr(r.error)));

/**
 * The railway switch (monadic bind). Chain a step that may itself fail.
 * The error type widens to the union of both steps' errors — the compiler
 * tracks every failure mode that can reach the caller.
 */
export const andThen = <E, A, E2, B>(
  r: Result<E, A>,
  f: (a: A) => Result<E2, B>,
): Result<E | E2, B> => (r.ok ? f(r.value) : r);

/** Recover from the error track with another Result. */
export const orElse = <E, A, E2, B>(
  r: Result<E, A>,
  f: (e: E) => Result<E2, B>,
): Result<E2, A | B> => (r.ok ? r : f(r.error));

/** Collapse both tracks into one value (catamorphism). */
export const match = <E, A, B>(r: Result<E, A>, onOk: (a: A) => B, onErr: (e: E) => B): B =>
  r.ok ? onOk(r.value) : onErr(r.error);

export const unwrapOr = <E, A, B>(r: Result<E, A>, fallback: B): A | B =>
  r.ok ? r.value : fallback;

export const unwrapOrElse = <E, A, B>(r: Result<E, A>, f: (e: E) => B): A | B =>
  r.ok ? r.value : f(r.error);

/** Run a side effect on success without changing the Result. */
export const tap = <E, A>(r: Result<E, A>, f: (a: A) => void): Result<E, A> => {
  if (r.ok) f(r.value);
  return r;
};

/** Run a side effect on failure without changing the Result. */
export const tapErr = <E, A>(r: Result<E, A>, f: (e: E) => void): Result<E, A> => {
  if (!r.ok) f(r.error);
  return r;
};

export const flatten = <E, E2, A>(r: Result<E, Result<E2, A>>): Result<E | E2, A> =>
  r.ok ? r.value : r;

/** Swap the tracks. */
export const swap = <E, A>(r: Result<E, A>): Result<A, E> => (r.ok ? err(r.value) : ok(r.error));

type OkValues<T extends ReadonlyArray<Result<unknown, unknown>>> = {
  -readonly [K in keyof T]: OkOf<T[K]>;
};

/**
 * Sequence: all succeed → Ok of all values (tuple-typed); otherwise the FIRST error.
 * Works for tuples (`all([a, b] as const)`) and homogeneous arrays.
 */
export function all<const T extends ReadonlyArray<Result<unknown, unknown>>>(
  results: T,
): Result<ErrOf<T[number]>, OkValues<T>> {
  const out = new Array(results.length) as unknown[];
  for (let i = 0; i < results.length; i++) {
    const r = results[i] as Result<unknown, unknown>;
    if (!r.ok) return r as Err<ErrOf<T[number]>>;
    out[i] = r.value;
  }
  return ok(out as OkValues<T>);
}

/**
 * Traverse: apply a fallible function to every item, stopping at the first error.
 * Equivalent to `all(items.map(f))` without the intermediate array.
 */
export const traverse = <E, A, B>(
  items: ReadonlyArray<A>,
  f: (a: A, index: number) => Result<E, B>,
): Result<E, B[]> => {
  const out = new Array<B>(items.length);
  for (let i = 0; i < items.length; i++) {
    const r = f(items[i] as A, i);
    if (!r.ok) return r;
    out[i] = r.value;
  }
  return ok(out);
};

/**
 * Accumulate: apply a fallible function to every item and collect EVERY error.
 * Use at input boundaries (show the user all problems) — not inside sequential workflows.
 */
export const validateAll = <E, A, B>(
  items: ReadonlyArray<A>,
  f: (a: A, index: number) => Result<E, B>,
): Result<NonEmptyArray<E>, B[]> => {
  const values: B[] = [];
  const errors: E[] = [];
  for (let i = 0; i < items.length; i++) {
    const r = f(items[i] as A, i);
    if (r.ok) values.push(r.value);
    else errors.push(r.error);
  }
  return errors.length === 0 ? ok(values) : err(errors as unknown as NonEmptyArray<E>);
};

/** Split results into successes and failures without failing (batch jobs). */
export const partition = <E, A>(
  results: ReadonlyArray<Result<E, A>>,
): { readonly oks: A[]; readonly errs: E[] } => {
  const oks: A[] = [];
  const errs: E[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i] as Result<E, A>;
    if (r.ok) oks.push(r.value);
    else errs.push(r.error);
  }
  return { oks, errs };
};

/**
 * Interop edge: run a function that may throw and convert the exception into a typed error.
 * This is the ONLY try/catch in the library and should be the only one in your codebase.
 */
export const fromThrowable = <E, A>(thunk: () => A, onThrow: (thrown: unknown) => E): Result<E, A> => {
  try {
    return ok(thunk());
  } catch (thrown) {
    return err(onThrow(thrown));
  }
};

/** Build a Result from a predicate. */
export const fromPredicate = <E, A>(value: A, predicate: (a: A) => boolean, onFalse: (a: A) => E): Result<E, A> =>
  predicate(value) ? ok(value) : err(onFalse(value));

/** Build a Result from a nullable value. */
export const fromNullable = <E, A>(value: A | null | undefined, onNull: () => E): Result<E, A> =>
  value === null || value === undefined ? err(onNull()) : ok(value);
