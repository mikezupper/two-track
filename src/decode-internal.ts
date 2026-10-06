/**
 * Shared internals of the decoder modules (decode-core, decode-dates, decode-compile).
 * Nothing here is public API: `two-track`'s `D` namespace re-exports decode.ts, which
 * does not re-export this module.
 */

import type { Option } from "./option.ts";
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

/**
 * Internal failure marker. A plain object with a private symbol so that any
 * decoded value — including user objects — can never be mistaken for it.
 */
const FAIL: unique symbol = Symbol("two-track/decode-failure");
export type Failure = { readonly [FAIL]: true; readonly issues: DecodeIssue[] };
export const isFailure = (x: unknown): x is Failure => typeof x === "object" && x !== null && FAIL in x;

/**
 * Internal: decode `input`, whose position is `path` + `key` (`key` is undefined at
 * the root). Returns the value or a Failure. Containers push `key` onto `path`
 * before descending and pop it after; leaves never touch `path`.
 */
export type Run<A> = (input: unknown, path: PathSegment[], key: PathSegment | undefined) => A | Failure;

export type Prim = "string" | "number" | "integer" | "boolean";
/** A fused primitive check. `regex` is set by `pattern` so the interpreter and the compiler can run `regex.test` inline instead of calling a closure. */
export type Check = { readonly test: (a: never) => boolean; readonly message: string; readonly regex?: RegExp };

export type Decoder<A> = {
  readonly decode: (input: unknown) => Result<DecodeError, A>;
  /** @internal */
  readonly run: Run<A>;
  /** @internal marker read by `struct` to make the key optional */
  readonly optional?: true;
  /** @internal primitive kind + fused checks, so `refine` chains stay one loop */
  readonly prim?: { readonly kind: Prim; readonly checks: ReadonlyArray<Check> };
  /** @internal the wrapped decoder of `optional`, so a container can still inline a primitive */
  readonly inner?: Decoder<unknown>;
  /** @internal structural shape, read by `compile` to generate literal-key code */
  readonly node?: Node;
};

/** @internal One descriptor per struct field. */
export type Field = {
  readonly key: string;
  readonly decoder: Decoder<unknown>;
  readonly prim: NonNullable<Decoder<unknown>["prim"]> | undefined;
  readonly optional: boolean;
  readonly risky: boolean;
  readonly proto: boolean;
};

/** @internal The structural subset `compile` understands; everything else is opaque and called through `run`. */
export type Node =
  | { readonly kind: "struct"; readonly fields: ReadonlyArray<Field> }
  | { readonly kind: "array"; readonly item: Decoder<unknown> }
  | { readonly kind: "nullable"; readonly inner: Decoder<unknown> }
  | { readonly kind: "option"; readonly inner: Decoder<unknown> }
  | { readonly kind: "optional"; readonly inner: Decoder<unknown> }
  | { readonly kind: "literal"; readonly values: ReadonlyArray<string | number | boolean | null> }
  | { readonly kind: "record"; readonly value: Decoder<unknown> }
  | { readonly kind: "taggedUnion"; readonly discriminant: string; readonly variants: Readonly<Record<string, Decoder<unknown>>>; readonly expected: string };

export type Infer<D> = D extends Decoder<infer A> ? A : never;

export const at = (path: PathSegment[], key: PathSegment | undefined): PathSegment[] => {
  const p = path.slice();
  if (key !== undefined) p.push(key);
  return p;
};

export const fail = (path: PathSegment[], key: PathSegment | undefined, message: string): Failure => ({
  [FAIL]: true,
  issues: [{ path: at(path, key), message }],
});

export const failWith = (issues: DecodeIssue[]): Failure => ({ [FAIL]: true, issues });

/** Merge a child's issues into the accumulator (reusing the first child's array). */
export const merge = (acc: DecodeIssue[] | undefined, f: Failure): DecodeIssue[] => {
  if (acc === undefined) return f.issues;
  for (let i = 0; i < f.issues.length; i++) acc.push(f.issues[i] as DecodeIssue);
  return acc;
};

export const toResult = <A>(r: A | Failure): Result<DecodeError, A> =>
  isFailure(r) ? err({ _tag: "DecodeError", issues: r.issues as unknown as NonEmptyArray<DecodeIssue> }) : ok(r);

export const make = <A>(run: Run<A>, prim?: NonNullable<Decoder<A>["prim"]>, node?: Node): Decoder<A> => {
  const decode = (input: unknown): Result<DecodeError, A> => toResult(run(input, [], undefined));
  if (prim !== undefined) return { decode, run, prim };
  if (node !== undefined) return { decode, run, node };
  return { decode, run };
};

export const PRIM_MESSAGE: Record<Prim, string> = {
  string: "expected string",
  number: "expected finite number",
  integer: "expected integer",
  boolean: "expected boolean",
};

/**
 * The primitive check as a plain function returning the failure MESSAGE (or undefined),
 * so containers can run a primitive field inline — no closure call, no Failure object
 * on the success path. This is what keeps a struct of primitives on one code path.
 */
export const primIssue = (prim: NonNullable<Decoder<unknown>["prim"]>, input: unknown): string | undefined => {
  const kind = prim.kind;
  if (kind === "string") {
    if (typeof input !== "string") return PRIM_MESSAGE.string;
  } else if (kind === "boolean") {
    if (typeof input !== "boolean") return PRIM_MESSAGE.boolean;
  } else if (typeof input !== "number" || !(kind === "number" ? Number.isFinite(input) : Number.isInteger(input))) {
    return PRIM_MESSAGE[kind];
  }
  const checks = prim.checks;
  for (let i = 0; i < checks.length; i++) {
    const c = checks[i] as Check;
    if (c.regex !== undefined) {
      // inline regex path (no closure call); a global/sticky regex is reset so it is stateless
      if (c.regex.global || c.regex.sticky) c.regex.lastIndex = 0;
      if (!c.regex.test(input as string)) return c.message;
    } else if (!c.test(input as never)) return c.message;
  }
  return undefined;
};

/** Keys that could be inherited from Object.prototype (or are the pollution vector). */
export const isRiskyKey = (key: string): boolean => key === "__proto__" || key in Object.prototype;

export const defineOwn = (out: Record<string, unknown>, key: string, value: unknown): void => {
  if (key === "__proto__") Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
  else out[key] = value;
};
