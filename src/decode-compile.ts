/**
 * `compile(decoder)` — the opt-in code-generated decoder (decision 0014).
 *
 * The interpreter's floor is a keyed loop: `obj[key]` for a key held in an array
 * is a generic property load, and that alone is ~94 ns per four-field object on V8.
 * JIT-compiled validators (ArkType, ajv, typia) are 5–7x faster because they emit
 * LITERAL property accesses (`o.id`, `out.id = …`) that the engine inlines. This
 * module does the same for the structural subset — struct, array, primitives with
 * fused checks, optional, nullable, option, literal — and calls `run` of any other
 * node (map, andThen, custom, lazy, oneOf, taggedUnion, json, record, refine over a
 * non-primitive) from the generated code, so semantics are identical by construction:
 * same messages, same paths, same accumulation order. A property test asserts
 * `compile(d).decode(x)` deep-equals `d.decode(x)` for generated decoders and inputs.
 *
 * It uses `new Function`. Where that is forbidden (CSP without `unsafe-eval`,
 * Cloudflare Workers, some browser extensions), `compile` returns the decoder
 * unchanged, so calling it is always safe and never slower.
 */

import type { Decoder, Failure, Field, Node, PathSegment, Run } from "./decode-internal.ts";
import { PRIM_MESSAGE, defineOwn, fail, failWith, isFailure, make, merge } from "./decode-internal.ts";
import { none, some } from "./option.ts";

/** Can this runtime create functions from source? Decided once. */
const canCompile = /* @__PURE__ */ ((): boolean => {
  try {
    return new Function("return 1")() === 1;
  } catch {
    return false;
  }
})();

/** Everything the generated code may reference, passed in as one argument. */
type Ctx = {
  readonly fail: typeof fail;
  readonly failWith: typeof failWith;
  readonly merge: typeof merge;
  readonly isFailure: typeof isFailure;
  readonly defineOwn: typeof defineOwn;
  readonly hasOwn: (o: object, k: PropertyKey) => boolean;
  readonly getProto: (o: object) => unknown;
  readonly some: typeof some;
  readonly none: typeof none;
  readonly isFinite: (n: number) => boolean;
  readonly isInteger: (n: number) => boolean;
  readonly checks: Array<(a: never) => boolean>;
  readonly runs: Array<Run<unknown>>;
  readonly values: Array<unknown>;
};

type Gen = { src: string[]; ctx: Ctx; tmp: number };

const lit = (s: unknown): string => JSON.stringify(s);
const fresh = (g: Gen, prefix: string): string => `${prefix}${g.tmp++}`;

/**
 * Emit code that decodes expression `v` (whose position is `path` + `keyExpr`) and then
 * either runs `onOk(valueExpr)` or `onFail(failureExpr)`. Containers push the key themselves.
 */
const emit = (g: Gen, d: Decoder<unknown>, v: string, keyExpr: string, onOk: (value: string) => string, onFail: (failure: string) => string): void => {
  const prim = d.prim;
  if (prim !== undefined && d.node === undefined) {
    const kind = prim.kind;
    const typeTest =
      kind === "string" ? `typeof ${v} !== "string"` : kind === "boolean" ? `typeof ${v} !== "boolean"` : `typeof ${v} !== "number" || !ctx.${kind === "number" ? "isFinite" : "isInteger"}(${v})`;
    g.src.push(`if (${typeTest}) { ${onFail(`ctx.fail(path, ${keyExpr}, ${lit(PRIM_MESSAGE[kind])})`)} }`);
    for (let i = 0; i < prim.checks.length; i++) {
      const c = prim.checks[i] as NonNullable<typeof prim.checks[number]>;
      const idx = g.ctx.checks.push(c.test) - 1;
      g.src.push(`else if (!ctx.checks[${idx}](${v})) { ${onFail(`ctx.fail(path, ${keyExpr}, ${lit(c.message)})`)} }`);
    }
    g.src.push(`else { ${onOk(v)} }`);
    return;
  }
  const node = d.node;
  if (node === undefined) {
    // Opaque node: call the interpreter for this subtree; semantics stay the interpreter's.
    const idx = g.ctx.runs.push(d.run) - 1;
    const r = fresh(g, "r");
    g.src.push(`var ${r} = ctx.runs[${idx}](${v}, path, ${keyExpr});`);
    g.src.push(`if (ctx.isFailure(${r})) { ${onFail(r)} } else { ${onOk(r)} }`);
    return;
  }
  switch (node.kind) {
    case "literal": {
      const test = node.values.map((x) => `${v} === ctx.values[${g.ctx.values.push(x) - 1}]`).join(" || ");
      const message = `expected one of ${node.values.map((x) => JSON.stringify(x)).join(", ")}`;
      g.src.push(`if (${test.length > 0 ? test : "false"}) { ${onOk(v)} } else { ${onFail(`ctx.fail(path, ${keyExpr}, ${lit(message)})`)} }`);
      return;
    }
    case "nullable":
      g.src.push(`if (${v} === null) { ${onOk("null")} } else {`);
      emit(g, node.inner, v, keyExpr, onOk, onFail);
      g.src.push("}");
      return;
    case "optional":
      g.src.push(`if (${v} === undefined) { ${onOk("undefined")} } else {`);
      emit(g, node.inner, v, keyExpr, onOk, onFail);
      g.src.push("}");
      return;
    case "option":
      g.src.push(`if (${v} === null || ${v} === undefined) { ${onOk("ctx.none")} } else {`);
      emit(g, node.inner, v, keyExpr, (val) => onOk(`ctx.some(${val})`), onFail);
      g.src.push("}");
      return;
    case "array": {
      const out = fresh(g, "a");
      const iss = fresh(g, "iss");
      const i = fresh(g, "i");
      const el = fresh(g, "e");
      g.src.push(`if (!Array.isArray(${v})) { ${onFail(`ctx.fail(path, ${keyExpr}, "expected array")`)} } else {`);
      g.src.push(`if (${keyExpr} !== undefined) path.push(${keyExpr});`);
      // `var` is function-scoped: initialise explicitly so a value left by a previous loop iteration
      // can never alias this iteration's issue list (that aliasing grew an array without bound).
      g.src.push(`var ${out} = new Array(${v}.length); var ${iss} = undefined;`);
      g.src.push(`for (var ${i} = 0; ${i} < ${v}.length; ${i}++) { var ${el} = ${v}[${i}];`);
      emit(g, node.item, el, i, (val) => `${out}[${i}] = ${val};`, (f) => `${iss} = ctx.merge(${iss}, ${f});`);
      g.src.push("}");
      g.src.push(`if (${keyExpr} !== undefined) path.pop();`);
      g.src.push(`if (${iss} === undefined) { ${onOk(out)} } else { ${onFail(`ctx.failWith(${iss})`)} }`);
      g.src.push("}");
      return;
    }
    case "struct": {
      const o = fresh(g, "o");
      const out = fresh(g, "s");
      const iss = fresh(g, "iss");
      const plain = fresh(g, "p");
      g.src.push(`if (typeof ${v} !== "object" || ${v} === null || Array.isArray(${v})) { ${onFail(`ctx.fail(path, ${keyExpr}, "expected object")`)} } else {`);
      g.src.push(`var ${o} = ${v}; var ${plain} = ctx.getProto(${o}); ${plain} = ${plain} === Object.prototype || ${plain} === null;`);
      g.src.push(`if (${keyExpr} !== undefined) path.push(${keyExpr});`);
      g.src.push(`var ${out} = {}; var ${iss} = undefined;`);
      for (let i = 0; i < node.fields.length; i++) {
        const f = node.fields[i] as Field;
        const k = lit(f.key);
        const fv = fresh(g, "f");
        // literal-key loads; the inherited-member guard only where it can matter
        g.src.push(f.risky ? `var ${fv} = ctx.hasOwn(${o}, ${k}) ? ${o}[${k}] : undefined;` : `var ${fv} = ${plain} ? ${o}[${k}] : (ctx.hasOwn(${o}, ${k}) ? ${o}[${k}] : undefined);`);
        const store = (val: string): string => (f.proto ? `ctx.defineOwn(${out}, ${k}, ${val});` : `${out}[${k}] = ${val};`);
        if (f.optional) {
          g.src.push(`if (${fv} !== undefined) {`);
          emit(g, f.decoder.inner ?? f.decoder, fv, k, store, (fl) => `${iss} = ctx.merge(${iss}, ${fl});`);
          g.src.push("}");
        } else {
          emit(g, f.decoder, fv, k, store, (fl) => `${iss} = ctx.merge(${iss}, ${fl});`);
        }
      }
      g.src.push(`if (${keyExpr} !== undefined) path.pop();`);
      g.src.push(`if (${iss} === undefined) { ${onOk(out)} } else { ${onFail(`ctx.failWith(${iss})`)} }`);
      g.src.push("}");
      return;
    }
  }
};

/**
 * Compile a decoder to a literal-key function. Returns the same decoder when the
 * runtime cannot create functions, or when there is nothing structural to compile
 * (a single opaque node gains nothing).
 */
export const compile = <A>(decoder: Decoder<A>): Decoder<A> => {
  if (!canCompile || (decoder.node === undefined && decoder.prim === undefined)) return decoder;
  const ctx: Ctx = {
    fail, failWith, merge, isFailure, defineOwn,
    hasOwn: Object.hasOwn,
    getProto: Object.getPrototypeOf,
    some, none,
    isFinite: Number.isFinite,
    isInteger: Number.isInteger,
    checks: [], runs: [], values: [],
  };
  const g: Gen = { src: [], ctx, tmp: 0 };
  g.src.push("var result;");
  emit(g, decoder as Decoder<unknown>, "input", "key", (val) => `result = ${val};`, (fl) => `result = ${fl};`);
  g.src.push("return result;");
  // eslint-free: `new Function` is the whole point of this module; see the header and decision 0014.
  const body = g.src.join("\n");
  const generated = new Function("ctx", `return function compiled(input, path, key) {\n${body}\n};`)(ctx) as Run<A | Failure>;
  const run: Run<A> = (input, path, key) => generated(input, path, key) as A | Failure;
  const compiled = make<A>(run, decoder.prim, decoder.node);
  return decoder.optional === true ? ({ ...compiled, optional: true, inner: decoder.inner } as Decoder<A>) : compiled;
};
