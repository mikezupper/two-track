/**
 * Decoders — parse, don't validate.
 *
 * A Decoder<A> turns `unknown` into `Result<DecodeError, A>`. It is the ONLY
 * runtime truth about external data: everything past a decoder is typed, and
 * nothing past a decoder re-checks. Decoders accumulate every issue in a
 * struct or array (boundaries report all problems), while workflows built on
 * Result fail fast.
 *
 * Speed: a decoder is straight-line `typeof` checks. The path is a mutable
 * stack owned by the decode call — pushed/popped by containers, copied only
 * when an issue is recorded — so the success path allocates nothing but the
 * output.
 */

import type { Brand } from "./brand.ts";
import type { Option } from "./option.ts";
import { none, some } from "./option.ts";
import type { NonEmptyArray, Result } from "./result.ts";
import { err, ok } from "./result.ts";

export type PathSegment = string | number;

export type DecodeIssue = {
  readonly path: ReadonlyArray<PathSegment>;
  readonly message: string;
};

export type DecodeError = {
  readonly _tag: "DecodeError";
  readonly issues: NonEmptyArray<DecodeIssue>;
};

/** Internal: decoders receive the shared mutable path stack. */
type Run<A> = (input: unknown, path: PathSegment[]) => Result<DecodeError, A>;

export type Decoder<A> = {
  readonly decode: (input: unknown) => Result<DecodeError, A>;
  /** @internal */
  readonly run: Run<A>;
  /** @internal marker read by `struct` to make the key optional */
  readonly optional?: true;
};

export type Infer<D> = D extends Decoder<infer A> ? A : never;

const issue = (path: PathSegment[], message: string): DecodeIssue => ({ path: path.slice(), message });

const fail = (path: PathSegment[], message: string): Result<DecodeError, never> =>
  err({ _tag: "DecodeError", issues: [issue(path, message)] });

const failMany = (issues: DecodeIssue[]): Result<DecodeError, never> =>
  err({ _tag: "DecodeError", issues: issues as unknown as NonEmptyArray<DecodeIssue> });

const make = <A>(run: Run<A>): Decoder<A> => ({ decode: (input) => run(input, []), run });

/** Render issues for logs and HTTP 400 bodies. */
export const formatIssues = (error: DecodeError): string =>
  error.issues.map((i) => `${i.path.length === 0 ? "$" : i.path.join(".")}: ${i.message}`).join("; ");

/** Build a custom decoder from a predicate-and-narrow function. */
export const custom = <A>(check: (input: unknown) => input is A, expected: string): Decoder<A> =>
  make((input, path) => (check(input) ? ok(input) : fail(path, `expected ${expected}`)));

// ---------- primitives ----------

export const unknown: Decoder<unknown> = make((input) => ok(input));

export const string: Decoder<string> = make((input, path) =>
  typeof input === "string" ? ok(input) : fail(path, "expected string"),
);

/** A finite number (rejects NaN and ±Infinity). */
export const number: Decoder<number> = make((input, path) =>
  typeof input === "number" && Number.isFinite(input) ? ok(input) : fail(path, "expected finite number"),
);

export const integer: Decoder<number> = make((input, path) =>
  typeof input === "number" && Number.isInteger(input) ? ok(input) : fail(path, "expected integer"),
);

export const boolean: Decoder<boolean> = make((input, path) =>
  typeof input === "boolean" ? ok(input) : fail(path, "expected boolean"),
);

export const literal = <const L extends ReadonlyArray<string | number | boolean | null>>(
  ...values: L
): Decoder<L[number]> =>
  make((input, path) => {
    for (let i = 0; i < values.length; i++) if (input === values[i]) return ok(input as L[number]);
    return fail(path, `expected one of ${values.map((v) => JSON.stringify(v)).join(", ")}`);
  });

// ---------- refinement & transformation ----------

export const refine = <A>(decoder: Decoder<A>, predicate: (a: A) => boolean, message: string): Decoder<A> =>
  make((input, path) => {
    const r = decoder.run(input, path);
    return r.ok && !predicate(r.value) ? fail(path, message) : r;
  });

/** Transform a decoded value (infallible). */
export const map = <A, B>(decoder: Decoder<A>, f: (a: A) => B): Decoder<B> =>
  make((input, path) => {
    const r = decoder.run(input, path);
    return r.ok ? ok(f(r.value)) : r;
  });

/** Transform a decoded value with a fallible step; the string is the issue message. */
export const andThen = <A, B>(decoder: Decoder<A>, f: (a: A) => Result<string, B>): Decoder<B> =>
  make((input, path) => {
    const r = decoder.run(input, path);
    if (!r.ok) return r;
    const next = f(r.value);
    return next.ok ? next : fail(path, next.error);
  });

/**
 * Apply a brand. The cast inside is the one sanctioned `as Brand<` in a codebase:
 * it sits behind the checks that justify it.
 */
export const brand = <A, Name extends string>(decoder: Decoder<A>, _name: Name): Decoder<Brand<A, Name>> =>
  decoder as unknown as Decoder<Brand<A, Name>>;

export const pattern = (regex: RegExp, message = `expected string matching ${regex}`): Decoder<string> =>
  refine(string, (s) => regex.test(s), message);

export const nonEmptyString: Decoder<string> = refine(string, (s) => s.length > 0, "expected non-empty string");

export const trimmed: Decoder<string> = map(string, (s) => s.trim());

export const minLength = (decoder: Decoder<string>, min: number): Decoder<string> =>
  refine(decoder, (s) => s.length >= min, `expected at least ${min} characters`);

export const maxLength = (decoder: Decoder<string>, max: number): Decoder<string> =>
  refine(decoder, (s) => s.length <= max, `expected at most ${max} characters`);

export const min = (decoder: Decoder<number>, minimum: number): Decoder<number> =>
  refine(decoder, (n) => n >= minimum, `expected >= ${minimum}`);

export const max = (decoder: Decoder<number>, maximum: number): Decoder<number> =>
  refine(decoder, (n) => n <= maximum, `expected <= ${maximum}`);

/** ISO-8601 string → Date, rejecting invalid dates. */
export const isoDate: Decoder<Date> = andThen(string, (s) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? err("expected ISO-8601 date string") : ok(d);
});

// ---------- containers ----------

export const nullable = <A>(decoder: Decoder<A>): Decoder<A | null> =>
  make((input, path) => (input === null ? ok(null) : decoder.run(input, path)));

/** `null | undefined` on the wire → Option in the domain. */
export const option = <A>(decoder: Decoder<A>): Decoder<Option<A>> =>
  make<Option<A>>((input, path) => {
    if (input === null || input === undefined) return ok<Option<A>>(none);
    const r = decoder.run(input, path);
    return r.ok ? ok<Option<A>>(some(r.value)) : r;
  });

/** Marks a struct field as optional (`key?: A`). Absent or `undefined` both decode to absent. */
export const optional = <A>(decoder: Decoder<A>): Decoder<A | undefined> & { readonly optional: true } => {
  const run: Run<A | undefined> = (input, path) => (input === undefined ? ok(undefined) : decoder.run(input, path));
  return { decode: (input) => run(input, []), run, optional: true };
};

export const array = <A>(item: Decoder<A>): Decoder<A[]> =>
  make((input, path) => {
    if (!Array.isArray(input)) return fail(path, "expected array");
    const out = new Array<A>(input.length);
    let issues: DecodeIssue[] | undefined;
    for (let i = 0; i < input.length; i++) {
      path.push(i);
      const r = item.run(input[i], path);
      path.pop();
      if (r.ok) out[i] = r.value;
      else if (issues === undefined) issues = r.error.issues.slice();
      else issues.push(...r.error.issues);
    }
    return issues === undefined ? ok(out) : failMany(issues);
  });

export const nonEmptyArray = <A>(item: Decoder<A>): Decoder<[A, ...A[]]> =>
  refine(array(item), (xs) => xs.length > 0, "expected non-empty array") as Decoder<[A, ...A[]]>;

export const record = <A>(value: Decoder<A>): Decoder<Record<string, A>> =>
  make((input, path) => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return fail(path, "expected object");
    const out: Record<string, A> = {};
    let issues: DecodeIssue[] | undefined;
    for (const key of Object.keys(input)) {
      path.push(key);
      const r = value.run((input as Record<string, unknown>)[key], path);
      path.pop();
      if (r.ok) out[key] = r.value;
      else if (issues === undefined) issues = r.error.issues.slice();
      else issues.push(...r.error.issues);
    }
    return issues === undefined ? ok(out) : failMany(issues);
  });

type Fields = Record<string, Decoder<unknown>>;
type OptionalKeys<F extends Fields> = { [K in keyof F]: F[K] extends { readonly optional: true } ? K : never }[keyof F];
type Simplify<T> = { [K in keyof T]: T[K] } & {};
export type StructOf<F extends Fields> = Simplify<
  { readonly [K in Exclude<keyof F, OptionalKeys<F>>]: Infer<F[K]> } & {
    readonly [K in OptionalKeys<F>]?: Exclude<Infer<F[K]>, undefined>;
  }
>;

/**
 * An object with the given fields. Unknown keys are ignored (the output only
 * ever contains declared keys, so nothing unvalidated leaks through).
 * Every field is checked; all issues are reported together.
 */
export const struct = <F extends Fields>(fields: F): Decoder<StructOf<F>> => {
  const keys = Object.keys(fields);
  const decoders = keys.map((k) => fields[k] as Decoder<unknown>);
  return make((input, path) => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return fail(path, "expected object");
    const obj = input as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    let issues: DecodeIssue[] | undefined;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i] as string;
      const decoder = decoders[i] as Decoder<unknown>;
      const raw = obj[key];
      if (raw === undefined && decoder.optional === true) continue;
      path.push(key);
      const r = decoder.run(raw, path);
      path.pop();
      if (r.ok) out[key] = r.value;
      else if (issues === undefined) issues = r.error.issues.slice();
      else issues.push(...r.error.issues);
    }
    return issues === undefined ? ok(out as StructOf<F>) : failMany(issues);
  });
};

type Variants<Key extends string> = Record<string, Decoder<{ readonly [K in Key]: string }>>;

/**
 * A discriminated union keyed by `key`. Picks the variant by the discriminant
 * value, so the issues are those of the one matching variant.
 *
 *   const Shape = D.taggedUnion("kind", {
 *     circle: D.struct({ kind: D.literal("circle"), radius: D.number }),
 *     square: D.struct({ kind: D.literal("square"), side: D.number }),
 *   });
 */
export const taggedUnion = <Key extends string, V extends Variants<Key>>(
  key: Key,
  variants: V,
): Decoder<Infer<V[keyof V]>> =>
  make((input, path) => {
    if (typeof input !== "object" || input === null) return fail(path, "expected object");
    const tag = (input as Record<string, unknown>)[key];
    if (typeof tag !== "string" || !Object.hasOwn(variants, tag)) {
      path.push(key);
      const r = fail(path, `expected one of ${Object.keys(variants).map((k) => JSON.stringify(k)).join(", ")}`);
      path.pop();
      return r;
    }
    return (variants[tag] as Decoder<Infer<V[keyof V]>>).run(input, path);
  });

/** Try alternatives in order; the issues reported are from the last alternative. */
export const oneOf = <const Ds extends ReadonlyArray<Decoder<unknown>>>(...decoders: Ds): Decoder<Infer<Ds[number]>> =>
  make((input, path) => {
    let last: Result<DecodeError, unknown> = fail(path, "expected one of the alternatives");
    for (let i = 0; i < decoders.length; i++) {
      last = (decoders[i] as Decoder<unknown>).run(input, path);
      if (last.ok) return last as Result<DecodeError, Infer<Ds[number]>>;
    }
    return last as Result<DecodeError, Infer<Ds[number]>>;
  });

/** Decode JSON text: parse (interop edge) then decode. */
export const json = <A>(decoder: Decoder<A>): Decoder<A> =>
  make((input, path) => {
    if (typeof input !== "string") return fail(path, "expected JSON string");
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch {
      return fail(path, "expected valid JSON");
    }
    return decoder.run(parsed, path);
  });

/** Recursive decoders: `const Tree: Decoder<Tree> = D.lazy(() => D.struct({ children: D.array(Tree) }))`. */
export const lazy = <A>(thunk: () => Decoder<A>): Decoder<A> => {
  let cached: Decoder<A> | undefined;
  return make((input, path) => (cached ??= thunk()).run(input, path));
};
