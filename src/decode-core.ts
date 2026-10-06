/**
 * Decoders — parse, don't validate.
 *
 * A Decoder<A> turns `unknown` into `Result<DecodeError, A>`. It is the ONLY
 * runtime truth about external data: everything past a decoder is typed, and
 * nothing past a decoder re-checks. Decoders accumulate every issue in a
 * struct or array (boundaries report all problems), while workflows built on
 * Result fail fast.
 *
 * Speed (decision 0014, after measuring against Zod/Valibot/ArkType; 0006 covers accumulation):
 * the internal protocol is not the public one. `run` returns the decoded value
 * itself, or a private `Failure` marker, so a `Result` is allocated once per
 * `decode` call rather than once per field. The path is a mutable stack that
 * only CONTAINERS push onto; a leaf receives its own key and materializes
 * `[...path, key]` only when it records an issue, so the success path does no
 * array work per field. Primitive refinements (`pattern`, `min`, `max`,
 * `nonEmptyString`, …) fuse into one check loop instead of nesting closures.
 */

import type { Brand } from "./brand.ts";
import type { Option } from "./option.ts";
import { none, some } from "./option.ts";
import type { Result } from "./result.ts";
import type { Check, Decoder, DecodeError, DecodeIssue, Field, PathSegment, Prim, Run } from "./decode-internal.ts";
import { defineOwn, fail, failWith, isFailure, isRiskyKey, make, merge, primIssue, toResult } from "./decode-internal.ts";

export type { Decoder, DecodeError, DecodeIssue, PathSegment } from "./decode-internal.ts";
export type Infer<D> = D extends Decoder<infer A> ? A : never;

// Date decoders live in ./decode-dates.ts and the compiler in ./decode-compile.ts
// (file-size invariant); ./decode.ts re-exports all three.

/** Render issues for logs and HTTP 400 bodies. */
export const formatIssues = (error: DecodeError): string =>
  error.issues.map((i) => `${i.path.length === 0 ? "$" : i.path.join(".")}: ${i.message}`).join("; ");

/** Build a custom decoder from a predicate-and-narrow function. */
export const custom = <A>(check: (input: unknown) => input is A, expected: string): Decoder<A> =>
  make((input, path, key) => (check(input) ? input : fail(path, key, `expected ${expected}`)));

// ---------- primitives (fusable) ----------

/** One flat loop: the typeof test, then every fused check in order. */
const primitive = <A>(kind: Prim, checks: ReadonlyArray<Check>): Decoder<A> => {
  const prim = { kind, checks };
  return make<A>((input, path, key) => {
    const message = primIssue(prim, input);
    return message === undefined ? (input as A) : fail(path, key, message);
  }, prim);
};

export const unknown: Decoder<unknown> = /* @__PURE__ */ make((input) => input);
export const string: Decoder<string> = /* @__PURE__ */ primitive("string", []);
/** A finite number (rejects NaN and ±Infinity). */
export const number: Decoder<number> = /* @__PURE__ */ primitive("number", []);
export const integer: Decoder<number> = /* @__PURE__ */ primitive("integer", []);
export const boolean: Decoder<boolean> = /* @__PURE__ */ primitive("boolean", []);

export const literal = <const L extends ReadonlyArray<string | number | boolean | null>>(
  ...values: L
): Decoder<L[number]> =>
  make(
    (input, path, key) => {
      for (let i = 0; i < values.length; i++) if (input === values[i]) return input as L[number];
      return fail(path, key, `expected one of ${values.map((v) => JSON.stringify(v)).join(", ")}`);
    },
    undefined,
    { kind: "literal", values },
  );

// ---------- refinement & transformation ----------

/**
 * Add a check. On a primitive decoder the check is FUSED into the primitive's
 * loop (no extra closure per layer); on any other decoder it wraps.
 */
export const refine = <A>(decoder: Decoder<A>, predicate: (a: A) => boolean, message: string): Decoder<A> => {
  if (decoder.prim !== undefined) {
    return primitive<A>(decoder.prim.kind, [...decoder.prim.checks, { test: predicate as (a: never) => boolean, message }]);
  }
  return make((input, path, key) => {
    const r = decoder.run(input, path, key);
    return !isFailure(r) && !predicate(r) ? fail(path, key, message) : r;
  });
};

/** Transform a decoded value (infallible). */
export const map = <A, B>(decoder: Decoder<A>, f: (a: A) => B): Decoder<B> =>
  make((input, path, key) => {
    const r = decoder.run(input, path, key);
    return isFailure(r) ? r : f(r);
  });

/** Transform a decoded value with a fallible step; the string is the issue message. */
export const andThen = <A, B>(decoder: Decoder<A>, f: (a: A) => Result<string, B>): Decoder<B> =>
  make((input, path, key) => {
    const r = decoder.run(input, path, key);
    if (isFailure(r)) return r;
    const next = f(r);
    return next.ok ? next.value : fail(path, key, next.error);
  });

/**
 * Apply a brand. The cast inside is the one sanctioned `as Brand<` in a codebase:
 * it sits behind the checks that justify it.
 */
export const brand = <A, Name extends string>(decoder: Decoder<A>, _name: Name): Decoder<Brand<A, Name>> =>
  decoder as unknown as Decoder<Brand<A, Name>>;

export const pattern = (regex: RegExp, message = `expected string matching ${regex}`): Decoder<string> => {
  const owned = new RegExp(regex.source, regex.flags);
  const sticky = owned.global || owned.sticky;
  return refine(
    string,
    sticky
      ? (s) => {
          owned.lastIndex = 0;
          return owned.test(s);
        }
      : (s) => owned.test(s),
    message,
  );
};

export const nonEmptyString: Decoder<string> = /* @__PURE__ */ refine(string, (s) => s.length > 0, "expected non-empty string");

export const trimmed: Decoder<string> = /* @__PURE__ */ map(string, (s) => s.trim());

export const minLength = (decoder: Decoder<string>, min: number): Decoder<string> =>
  refine(decoder, (s) => s.length >= min, `expected at least ${min} characters`);

export const maxLength = (decoder: Decoder<string>, max: number): Decoder<string> =>
  refine(decoder, (s) => s.length <= max, `expected at most ${max} characters`);

export const min = (decoder: Decoder<number>, minimum: number): Decoder<number> =>
  refine(decoder, (n) => n >= minimum, `expected >= ${minimum}`);

export const max = (decoder: Decoder<number>, maximum: number): Decoder<number> =>
  refine(decoder, (n) => n <= maximum, `expected <= ${maximum}`);

// ---------- containers ----------

export const nullable = <A>(decoder: Decoder<A>): Decoder<A | null> =>
  make((input, path, key) => (input === null ? null : decoder.run(input, path, key)), undefined, { kind: "nullable", inner: decoder as Decoder<unknown> });

/** `null | undefined` on the wire → Option in the domain. */
export const option = <A>(decoder: Decoder<A>): Decoder<Option<A>> =>
  make<Option<A>>(
    (input, path, key) => {
      if (input === null || input === undefined) return none;
      const r = decoder.run(input, path, key);
      return isFailure(r) ? r : some(r);
    },
    undefined,
    { kind: "option", inner: decoder as Decoder<unknown> },
  );

/** Marks a struct field as optional (`key?: A`). Absent or `undefined` both decode to absent. */
export const optional = <A>(decoder: Decoder<A>): Decoder<A | undefined> & { readonly optional: true } => {
  const run: Run<A | undefined> = (input, path, key) => (input === undefined ? undefined : decoder.run(input, path, key));
  return { decode: (input) => toResult(run(input, [], undefined)), run, optional: true, inner: decoder as Decoder<unknown>, node: { kind: "optional", inner: decoder as Decoder<unknown> } };
};

export const array = <A>(item: Decoder<A>): Decoder<ReadonlyArray<A>> => {
  const prim = item.prim;
  return make((input, path, key) => {
    if (!Array.isArray(input)) return fail(path, key, "expected array");
    const nested = key !== undefined;
    if (nested) path.push(key);
    const out = new Array<A>(input.length);
    let issues: DecodeIssue[] | undefined;
    if (prim !== undefined) {
      for (let i = 0; i < input.length; i++) {
        const v: unknown = input[i];
        const message = primIssue(prim, v);
        if (message === undefined) out[i] = v as A;
        else issues = merge(issues, fail(path, i, message));
      }
    } else {
      for (let i = 0; i < input.length; i++) {
        const r = item.run(input[i], path, i);
        if (isFailure(r)) issues = merge(issues, r);
        else out[i] = r;
      }
    }
    if (nested) path.pop();
    return issues === undefined ? out : failWith(issues);
  }, undefined, { kind: "array", item: item as Decoder<unknown> });
};

/** Decoded collections are `readonly`: immutability is a type-level property here (decision 0003). */
export const nonEmptyArray = <A>(item: Decoder<A>): Decoder<readonly [A, ...A[]]> =>
  refine(array(item), (xs) => xs.length > 0, "expected non-empty array") as Decoder<readonly [A, ...A[]]>;


export const record = <A>(value: Decoder<A>): Decoder<Record<string, A>> =>
  make((input, path, key) => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return fail(path, key, "expected object");
    const nested = key !== undefined;
    if (nested) path.push(key);
    const out: Record<string, A> = {};
    let issues: DecodeIssue[] | undefined;
    for (const k of Object.keys(input)) {
      const r = value.run((input as Record<string, unknown>)[k], path, k);
      if (isFailure(r)) issues = merge(issues, r);
      else defineOwn(out, k, r);
    }
    if (nested) path.pop();
    return issues === undefined ? out : failWith(issues);
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
 * ever contains declared keys, so nothing unvalidated leaks through); only OWN
 * fields are read, so inherited members never decode. Every field is checked;
 * all issues are reported together.
 */
export const struct = <F extends Fields>(fields: F): Decoder<StructOf<F>> => {
  // One descriptor per field (one monomorphic load per iteration instead of six array reads).
  // A primitive field — directly or behind `optional` — is checked inline, with no closure call.
  const descriptors: ReadonlyArray<Field> = Object.keys(fields).map((key) => {
    const decoder = fields[key] as Decoder<unknown>;
    return { key, decoder, prim: decoder.prim ?? decoder.inner?.prim, optional: decoder.optional === true, risky: isRiskyKey(key), proto: key === "__proto__" };
  });
  const n = descriptors.length;
  return make((input, path, key) => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return fail(path, key, "expected object");
    const obj = input as Record<string, unknown>;
    const proto: unknown = Object.getPrototypeOf(obj);
    const plain = proto === Object.prototype || proto === null;
    const nested = key !== undefined;
    if (nested) path.push(key);
    const out: Record<string, unknown> = {};
    let issues: DecodeIssue[] | undefined;
    for (let i = 0; i < n; i++) {
      const f = descriptors[i] as Field;
      const k = f.key;
      const raw = plain && !f.risky ? obj[k] : Object.hasOwn(obj, k) ? obj[k] : undefined;
      if (raw === undefined && f.optional) continue;
      const prim = f.prim;
      if (prim !== undefined) {
        const message = primIssue(prim, raw);
        if (message !== undefined) issues = merge(issues, fail(path, k, message));
        else if (f.proto) defineOwn(out, k, raw);
        else out[k] = raw;
        continue;
      }
      const r = f.decoder.run(raw, path, k);
      if (isFailure(r)) issues = merge(issues, r);
      else if (f.proto) defineOwn(out, k, r);
      else out[k] = r;
    }
    if (nested) path.pop();
    return issues === undefined ? (out as StructOf<F>) : failWith(issues);
  }, undefined, { kind: "struct", fields: descriptors });
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
  discriminant: Key,
  variants: V,
): Decoder<Infer<V[keyof V]>> => {
  const expected = `expected one of ${Object.keys(variants).map((k) => JSON.stringify(k)).join(", ")}`;
  return make((input, path, key) => {
    if (typeof input !== "object" || input === null) return fail(path, key, "expected object");
    const tag = (input as Record<string, unknown>)[discriminant];
    if (typeof tag !== "string" || !Object.hasOwn(variants, tag)) {
      const nested = key !== undefined;
      if (nested) path.push(key);
      const f = fail(path, discriminant, expected);
      if (nested) path.pop();
      return f;
    }
    return (variants[tag] as Decoder<Infer<V[keyof V]>>).run(input, path, key);
  });
};

/**
 * Try alternatives in order; the first success wins. On failure EVERY alternative's issues
 * are reported, each message prefixed `alternative N:`, so the reader sees why each branch
 * rejected the value (the same accumulate-everything rule as `struct`). Prefer `taggedUnion`
 * when a discriminant exists: it reports only the matching branch's issues.
 */
export const oneOf = <const Ds extends ReadonlyArray<Decoder<unknown>>>(...decoders: Ds): Decoder<Infer<Ds[number]>> =>
  make((input, path, key) => {
    if (decoders.length === 0) return fail(path, key, "expected one of the alternatives");
    let issues: DecodeIssue[] | undefined;
    for (let i = 0; i < decoders.length; i++) {
      const r = (decoders[i] as Decoder<unknown>).run(input, path, key);
      if (!isFailure(r)) return r as Infer<Ds[number]>;
      for (let j = 0; j < r.issues.length; j++) {
        const issue = r.issues[j] as DecodeIssue;
        (issues ??= []).push({ path: issue.path, message: `alternative ${i + 1}: ${issue.message}` });
      }
    }
    return failWith(issues as DecodeIssue[]);
  });

/** Decode JSON text: parse (interop edge) then decode. */
export const json = <A>(decoder: Decoder<A>): Decoder<A> =>
  make((input, path, key) => {
    if (typeof input !== "string") return fail(path, key, "expected JSON string");
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch {
      return fail(path, key, "expected valid JSON");
    }
    return decoder.run(parsed, path, key);
  });

/** Recursive decoders: `const Tree: Decoder<Tree> = D.lazy(() => D.struct({ children: D.array(Tree) }))`. */
export const lazy = <A>(thunk: () => Decoder<A>): Decoder<A> => {
  let cached: Decoder<A> | undefined;
  return make((input, path, key) => (cached ??= thunk()).run(input, path, key));
};
