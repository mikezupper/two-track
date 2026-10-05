/**
 * Option — presence or absence, without null.
 *
 * Same encoding rules as Result: boolean discriminant, literal shapes, and a
 * shared `none` singleton so the absent path allocates nothing.
 */

export type Some<A> = { readonly some: true; readonly value: A };
export type None = { readonly some: false };
export type Option<A> = Some<A> | None;

export const some = <A>(value: A): Some<A> => ({ some: true, value });
export const none: None = { some: false };

export const isSome = <A>(o: Option<A>): o is Some<A> => o.some;
export const isNone = <A>(o: Option<A>): o is None => !o.some;

export const map = <A, B>(o: Option<A>, f: (a: A) => B): Option<B> => (o.some ? some(f(o.value)) : none);

export const andThen = <A, B>(o: Option<A>, f: (a: A) => Option<B>): Option<B> =>
  o.some ? f(o.value) : none;

export const orElse = <A, B>(o: Option<A>, f: () => Option<B>): Option<A | B> => (o.some ? o : f());

export const filter = <A>(o: Option<A>, predicate: (a: A) => boolean): Option<A> =>
  o.some && predicate(o.value) ? o : none;

export const match = <A, B>(o: Option<A>, onSome: (a: A) => B, onNone: () => B): B =>
  o.some ? onSome(o.value) : onNone();

export const unwrapOr = <A, B>(o: Option<A>, fallback: B): A | B => (o.some ? o.value : fallback);

export const unwrapOrElse = <A, B>(o: Option<A>, f: () => B): A | B => (o.some ? o.value : f());

/** Boundary only: lift a nullable value coming from outside (DB driver, DOM, JSON). */
export const fromNullable = <A>(value: A | null | undefined): Option<NonNullable<A>> =>
  value === null || value === undefined ? none : some(value as NonNullable<A>);

/** Boundary only: hand a value to an API that wants null. */
export const toNullable = <A>(o: Option<A>): A | null => (o.some ? o.value : null);

export const toUndefined = <A>(o: Option<A>): A | undefined => (o.some ? o.value : undefined);

/** Turn absence into a typed error. */
export const toResult = <E, A>(o: Option<A>, onNone: () => E): import("./result.ts").Result<E, A> =>
  o.some ? { ok: true, value: o.value } : { ok: false, error: onNone() };

/** Sequence: all present → Some of all values; otherwise None. */
export const all = <A>(options: ReadonlyArray<Option<A>>): Option<A[]> => {
  const out = new Array<A>(options.length);
  for (let i = 0; i < options.length; i++) {
    const o = options[i] as Option<A>;
    if (!o.some) return none;
    out[i] = o.value;
  }
  return some(out);
};

/** Find the first element satisfying the predicate as an Option. */
export const find = <A>(items: ReadonlyArray<A>, predicate: (a: A) => boolean): Option<A> => {
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as A;
    if (predicate(item)) return some(item);
  }
  return none;
};
