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
 * output. Measured (bench/cross): 15–30% faster than Zod/Valibot, 3–4x slower
 * than ArkType's JIT-compiled validator on valid input; see benchmarks.md.
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

/** Copy the first child's issues; append later issues without argument-count limits. */
const appendIssues = (issues: DecodeIssue[] | undefined, incoming: NonEmptyArray<DecodeIssue>): DecodeIssue[] => {
  if (issues === undefined) return incoming.slice();
  for (let i = 0; i < incoming.length; i++) issues.push(incoming[i] as DecodeIssue);
  return issues;
};

const make = <A>(run: Run<A>): Decoder<A> => ({ decode: (input) => run(input, []), run });

/** Render issues for logs and HTTP 400 bodies. */
export const formatIssues = (error: DecodeError): string =>
  error.issues.map((i) => `${i.path.length === 0 ? "$" : i.path.join(".")}: ${i.message}`).join("; ");

/** Build a custom decoder from a predicate-and-narrow function. */
export const custom = <A>(check: (input: unknown) => input is A, expected: string): Decoder<A> =>
  make((input, path) => (check(input) ? ok(input) : fail(path, `expected ${expected}`)));

// ---------- primitives ----------

export const unknown: Decoder<unknown> = /* @__PURE__ */ make((input) => ok(input));

export const string: Decoder<string> = /* @__PURE__ */ make((input, path) =>
  typeof input === "string" ? ok(input) : fail(path, "expected string"),
);

/** A finite number (rejects NaN and ±Infinity). */
export const number: Decoder<number> = /* @__PURE__ */ make((input, path) =>
  typeof input === "number" && Number.isFinite(input) ? ok(input) : fail(path, "expected finite number"),
);

export const integer: Decoder<number> = /* @__PURE__ */ make((input, path) =>
  typeof input === "number" && Number.isInteger(input) ? ok(input) : fail(path, "expected integer"),
);

export const boolean: Decoder<boolean> = /* @__PURE__ */ make((input, path) =>
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

export const pattern = (regex: RegExp, message = `expected string matching ${regex}`): Decoder<string> => {
  const owned = new RegExp(regex.source, regex.flags);
  return refine(string, (s) => {
    owned.lastIndex = 0;
    return owned.test(s);
  }, message);
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

/**
 * The engine's `Date` string grammar → Date. Named for what it does: it accepts whatever
 * `new Date(string)` accepts, which includes non-ISO forms and silently normalizes invalid
 * calendar dates (`2023-02-30` → March 2). Use it only when the producer is known and
 * sloppy; wire data should use `isoDate`.
 */
export const dateFromString: Decoder<Date> = /* @__PURE__ */ andThen(string, (s) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? err("expected a date string") : ok(d);
});

const ISO_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2}))?$/;

const daysInMonth = (year: number, month: number): number =>
  month === 2 ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;

/**
 * Strict ISO-8601 → Date. Accepts exactly `YYYY-MM-DD` (UTC midnight) or
 * `YYYY-MM-DDTHH:mm[:ss[.fraction]]` followed by `Z` or `±HH:mm`; rejects every other
 * form, a date-time without an offset (ambiguous on the wire), and calendar-invalid
 * dates such as `2023-02-30` or `2023-02-29`, which `new Date` would silently shift.
 * The name is the contract: if it decodes, the string was ISO-8601 and the instant is
 * the one written.
 */
export const isoDate: Decoder<Date> = /* @__PURE__ */ andThen(string, (s) => {
  const m = ISO_DATE_TIME.exec(s);
  if (m === null) return err("expected ISO-8601 date (YYYY-MM-DD) or date-time with Z/±HH:mm offset");
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return err("expected a valid calendar date");
  if (m[4] !== undefined) {
    const hour = Number(m[4]);
    const minute = Number(m[5]);
    const second = m[6] === undefined ? 0 : Number(m[6]);
    if (hour > 23 || minute > 59 || second > 59) return err("expected a valid time of day");
    const offset = m[8] as string;
    if (offset !== "Z" && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4, 6)) > 59)) return err("expected a valid UTC offset");
  }
  // V8/JSC/SpiderMonkey all parse this subset per spec; fractions beyond 3 digits are truncated.
  const d = new Date(m[7] !== undefined && m[7].length > 3 ? s.replace(`.${m[7]}`, `.${m[7].slice(0, 3)}`) : s);
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
      else issues = appendIssues(issues, r.error.issues);
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
      if (r.ok) {
        if (key === "__proto__") Object.defineProperty(out, key, { value: r.value, enumerable: true, writable: true, configurable: true });
        else out[key] = r.value;
      } else issues = appendIssues(issues, r.error.issues);
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
      const raw = Object.hasOwn(obj, key) ? obj[key] : undefined;
      if (raw === undefined && decoder.optional === true) continue;
      path.push(key);
      const r = decoder.run(raw, path);
      path.pop();
      if (r.ok) {
        if (key === "__proto__") Object.defineProperty(out, key, { value: r.value, enumerable: true, writable: true, configurable: true });
        else out[key] = r.value;
      } else issues = appendIssues(issues, r.error.issues);
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

/**
 * Try alternatives in order; the first success wins. On failure EVERY alternative's issues
 * are reported, each message prefixed `alternative N:`, so the reader sees why each branch
 * rejected the value (the same accumulate-everything rule as `struct`). Prefer `taggedUnion`
 * when a discriminant exists: it reports only the matching branch's issues.
 */
export const oneOf = <const Ds extends ReadonlyArray<Decoder<unknown>>>(...decoders: Ds): Decoder<Infer<Ds[number]>> =>
  make((input, path) => {
    if (decoders.length === 0) return fail(path, "expected one of the alternatives");
    let issues: DecodeIssue[] | undefined;
    for (let i = 0; i < decoders.length; i++) {
      const result = (decoders[i] as Decoder<unknown>).run(input, path);
      if (result.ok) return result as Result<DecodeError, Infer<Ds[number]>>;
      for (let j = 0; j < result.error.issues.length; j++) {
        const issue = result.error.issues[j] as DecodeIssue;
        (issues ??= []).push({ path: issue.path, message: `alternative ${i + 1}: ${issue.message}` });
      }
    }
    return failMany(issues as DecodeIssue[]);
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
