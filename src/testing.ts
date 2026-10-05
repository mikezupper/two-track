/**
 * two-track/testing — laws and round-trips as one-line property tests.
 *
 * Core belief #8: laws are tests. The library proves its own functor/monad
 * laws with fast-check; this entry point lets an application prove the same
 * for its custom combinators and decoders.
 *
 * Design constraint: two-track has zero runtime dependencies and this module
 * ships in the package, so it does NOT import fast-check. Every helper takes
 * the fast-check module as its first argument and types it structurally
 * (`FastCheckLike`) with only the members it uses. Pass `fc` straight through:
 *
 *   import fc from "fast-check";
 *   import { functorLaws } from "two-track/testing";
 *   functorLaws(fc, { arb: arbMyBox, map: Box.map });
 *
 * Every law helper runs `fc.assert(fc.property(...))` itself, so a violated
 * law surfaces as a fast-check failure with the shrunk counterexample.
 */

import type { Decoder } from "./decode.ts";
import type { Option } from "./option.ts";
import { none, some } from "./option.ts";
import type { Result } from "./result.ts";
import { err, ok } from "./result.ts";

/** The subset of a fast-check `Arbitrary<T>` these helpers rely on. */
export type Arb<T> = {
  map<U>(mapper: (t: T) => U): Arb<U>;
  filter(predicate: (t: T) => boolean): Arb<T>;
  chain<U>(chainer: (t: T) => Arb<U>): Arb<U>;
};

/**
 * The subset of the fast-check module these helpers rely on. Members are
 * declared as methods (not function-typed properties) so that fast-check's
 * richer overloads stay assignable under `strictFunctionTypes`.
 */
export type FastCheckLike = {
  boolean(): Arb<boolean>;
  integer(constraints?: { readonly min?: number; readonly max?: number }): Arb<number>;
  string(constraints?: { readonly minLength?: number; readonly maxLength?: number }): Arb<string>;
  anything(): Arb<unknown>;
  /** `fc.property(...arbitraries, predicate)`; typed loosely, the helpers never inspect the result. */
  property(...args: ReadonlyArray<unknown>): unknown;
  /** `fc.assert(property, params?)`; throws (fast-check's own error) when the property fails. */
  assert(property: unknown, params?: unknown): unknown;
};

export type Eq<T> = (a: T, b: T) => boolean;

/**
 * Default equality: compares `JSON.stringify` output. Adequate for the plain
 * data two-track encourages. Known limits: `undefined` fields are dropped,
 * `NaN` and `±Infinity` become `null`, `Map`/`Set` become `{}`, `Date` becomes
 * its ISO string, and key order matters. Pass your own `equals` otherwise.
 */
export const structuralEq: Eq<unknown> = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- arbitraries ----------

/** Results, roughly half Ok and half Err. */
export const arbResult = <E, A>(fc: FastCheckLike, arbError: Arb<E>, arbValue: Arb<A>): Arb<Result<E, A>> =>
  fc.boolean().chain((isOk): Arb<Result<E, A>> => (isOk ? arbValue.map((a) => ok<A>(a) as Result<E, A>) : arbError.map((e) => err<E>(e) as Result<E, A>)));

/** Options, roughly half Some and half None. */
export const arbOption = <A>(fc: FastCheckLike, arbValue: Arb<A>): Arb<Option<A>> =>
  fc.boolean().chain((isSome): Arb<Option<A>> => (isSome ? arbValue.map((a) => some<A>(a) as Option<A>) : arbValue.map((): Option<A> => none)));

/**
 * Values that pass a decoder, obtained by decoding a raw arbitrary and keeping
 * the successes. Keep `raw` close to the decoder's shape (e.g. `fc.record`
 * matching the struct) or fast-check will report the property as exhausted
 * after too many discards.
 */
export const arbDecoded = <A>(fc: FastCheckLike, raw: Arb<unknown>, decoder: Decoder<A>): Arb<A> => {
  void fc;
  return raw
    .map((input) => decoder.decode(input))
    .filter((r) => r.ok)
    .map((r) => (r as { readonly ok: true; readonly value: A }).value);
};

// ---------- laws ----------

/** number -> number functions with varied slope and offset; enough to distinguish map from most wrong maps. */
const arbNumberFn = (fc: FastCheckLike): Arb<(n: number) => number> =>
  fc
    .integer({ min: -1000, max: 1000 })
    .chain((a) => fc.integer({ min: -1000, max: 1000 }).map((b) => (n: number): number => Math.imul(a, n) + b));

/**
 * Functor laws for a `map` over a container of numbers:
 *   identity:    map(fa, x => x) == fa
 *   composition: map(map(fa, f), g) == map(fa, x => g(f(x)))
 */
export const functorLaws = <F>(
  fc: FastCheckLike,
  spec: { readonly arb: Arb<F>; readonly map: (fa: F, f: (a: number) => number) => F; readonly equals?: Eq<F> },
): void => {
  const equals = spec.equals ?? structuralEq;
  fc.assert(fc.property(spec.arb, (fa: F) => equals(spec.map(fa, (x) => x), fa)));
  fc.assert(
    fc.property(spec.arb, arbNumberFn(fc), arbNumberFn(fc), (fa: F, f: (n: number) => number, g: (n: number) => number) =>
      equals(spec.map(spec.map(fa, f), g), spec.map(fa, (x) => g(f(x)))),
    ),
  );
};

/**
 * Monad laws for an `of` / `andThen` pair over numbers:
 *   left identity:  andThen(of(a), f) == f(a)
 *   right identity: andThen(fa, of) == fa
 *   associativity:  andThen(andThen(fa, f), g) == andThen(fa, x => andThen(f(x), g))
 * `arbKleisli` generates the `f`/`g` functions, e.g. `fc.func(arbF)`.
 */
export const monadLaws = <F>(
  fc: FastCheckLike,
  spec: {
    readonly arb: Arb<F>;
    readonly of: (a: number) => F;
    readonly andThen: (fa: F, f: (a: number) => F) => F;
    readonly arbKleisli: Arb<(a: number) => F>;
    readonly equals?: Eq<F>;
  },
): void => {
  const equals = spec.equals ?? structuralEq;
  fc.assert(fc.property(fc.integer(), spec.arbKleisli, (a: number, f: (a: number) => F) => equals(spec.andThen(spec.of(a), f), f(a))));
  fc.assert(fc.property(spec.arb, (fa: F) => equals(spec.andThen(fa, spec.of), fa)));
  fc.assert(
    fc.property(spec.arb, spec.arbKleisli, spec.arbKleisli, (fa: F, f: (a: number) => F, g: (a: number) => F) =>
      equals(spec.andThen(spec.andThen(fa, f), g), spec.andThen(fa, (x) => spec.andThen(f(x), g))),
    ),
  );
};

// ---------- decoders ----------

/**
 * `decode(encode(a))` is `ok(a)` for every generated `a`. `encode` defaults to
 * identity; supply it when the wire shape differs from the domain shape
 * (e.g. an `Option` field that is `null` on the wire).
 */
export const decoderRoundTrip = <A>(
  fc: FastCheckLike,
  decoder: Decoder<A>,
  arb: Arb<A>,
  options: { readonly encode?: (a: A) => unknown; readonly equals?: Eq<A> } = {},
): void => {
  const encode = options.encode ?? ((a: A): unknown => a);
  const equals = options.equals ?? structuralEq;
  fc.assert(
    fc.property(arb, (a: A) => {
      const r = decoder.decode(encode(a));
      return r.ok && equals(r.value, a);
    }),
  );
};

/** `decoder.decode` never throws and always returns a Result, whatever the input. */
export const decoderNeverThrows = (fc: FastCheckLike, decoder: Decoder<unknown>): void => {
  fc.assert(fc.property(fc.anything(), (input: unknown) => typeof decoder.decode(input).ok === "boolean"));
};

/** Decoding is pure: the input is unchanged afterwards (compared by JSON snapshot). */
export const decoderDoesNotMutate = <A>(fc: FastCheckLike, decoder: Decoder<A>, arb: Arb<unknown>): void => {
  fc.assert(
    fc.property(arb, (input: unknown) => {
      const before = JSON.stringify(input);
      decoder.decode(input);
      return JSON.stringify(input) === before;
    }),
  );
};
