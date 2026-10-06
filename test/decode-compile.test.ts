import { afterEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { D, O, err, ok, type Decoder } from "../src/index.ts";

const same = (a: unknown, b: unknown): void => expect(JSON.stringify(a)).toBe(JSON.stringify(b));

const Line = D.struct({ sku: D.pattern(/^[A-Z]{3}-\d{3}$/), qty: D.max(D.min(D.integer, 1), 99), gift: D.option(D.boolean), note: D.optional(D.nonEmptyString) });
const Order = D.struct({
  id: D.brand(D.pattern(/^o_\w+$/), "OrderId"),
  lines: D.nonEmptyArray(Line),
  tags: D.array(D.literal("a", "b", 1, null)),
  status: D.taggedUnion("kind", { open: D.struct({ kind: D.literal("open") }), closed: D.struct({ kind: D.literal("closed"), at: D.isoDate }) }),
  meta: D.record(D.number),
  total: D.map(D.number, (n) => Math.round(n)),
  coupon: D.nullable(D.string),
  either: D.oneOf(D.number, D.literal("n/a")),
  raw: D.json(D.struct({ a: D.integer })),
  constructor: D.optional(D.string),
  toString: D.optional(D.number),
  ["__proto__"]: D.optional(D.struct({ polluted: D.boolean })), // computed key: a literal `__proto__:` would set the prototype, not a field
});
const Tree: Decoder<{ readonly v: number; readonly kids: ReadonlyArray<unknown> }> = D.lazy(() => D.struct({ v: D.number, kids: D.array(Tree) }));

const arbOrderWire = fc.record({
  id: fc.stringMatching(/^o_[a-z0-9]{1,6}$/),
  lines: fc.array(fc.record({ sku: fc.stringMatching(/^[A-Z]{3}-\d{3}$/), qty: fc.integer({ min: 1, max: 99 }), gift: fc.option(fc.boolean(), { nil: null }), note: fc.option(fc.string({ minLength: 1 }), { nil: undefined }) }), { minLength: 1, maxLength: 4 }),
  tags: fc.array(fc.constantFrom("a", "b", 1, null)),
  status: fc.oneof(fc.constant({ kind: "open" }), fc.constant({ kind: "closed", at: "2026-10-06T12:00:00Z" })),
  meta: fc.dictionary(fc.string(), fc.double({ noNaN: true, noDefaultInfinity: true })),
  total: fc.double({ noNaN: true, noDefaultInfinity: true }),
  coupon: fc.option(fc.string(), { nil: null }),
  either: fc.oneof(fc.double({ noNaN: true, noDefaultInfinity: true }), fc.constant("n/a")),
  raw: fc.integer().map((a) => JSON.stringify({ a })),
});

/** Randomly corrupt a valid wire object so error paths and accumulation are exercised too. */
const corrupt = (o: Record<string, unknown>, seed: number): unknown => {
  const c = { ...o };
  if (seed % 7 === 0) return seed;
  if (seed % 5 === 0) delete c["id"];
  if (seed % 3 === 0) c["lines"] = [{ sku: "bad", qty: 0 }, 42];
  if (seed % 2 === 0) c["tags"] = ["z", 2];
  if (seed % 11 === 0) c["status"] = { kind: "weird" };
  if (seed % 13 === 0) c["raw"] = "{";
  return c;
};

describe("D.compile equals the interpreter", () => {
  const compiled = D.compile(Order);

  it("compiles to a different function when compilation is available", () => {
    expect(compiled).not.toBe(Order);
    expect(compiled.decode).not.toBe(Order.decode);
  });

  it("valid and corrupted wire objects: identical Results, issues, paths and order (property)", () => {
    fc.assert(
      fc.property(arbOrderWire, fc.nat(), (wire, seed) => {
        const input = corrupt(wire as Record<string, unknown>, seed);
        same(compiled.decode(input), Order.decode(input));
        same(compiled.decode(wire), Order.decode(wire));
      }),
      { numRuns: 300 },
    );
  });

  it("anything at all: identical Results (property)", () => {
    fc.assert(fc.property(fc.anything(), (x) => { same(compiled.decode(x), Order.decode(x)); }), { numRuns: 500 });
    const Items = D.compile(D.array(D.array(D.option(D.integer))));
    fc.assert(fc.property(fc.anything(), (x) => { same(Items.decode(x), D.array(D.array(D.option(D.integer))).decode(x)); }), { numRuns: 300 });
  });

  it("inherited members, prototype-less objects, class instances and __proto__ behave the same", () => {
    const Risky = D.struct({ constructor: D.optional(D.string), toString: D.optional(D.number), hasOwnProperty: D.optional(D.boolean), ["__proto__"]: D.optional(D.struct({ p: D.boolean })), x: D.integer });
    const C = D.compile(Risky);
    class Thing { x = 1; toString(): string { return "t"; } }
    const bare = Object.create(null) as Record<string, unknown>;
    bare["x"] = 2;
    bare["constructor"] = "own";
    const polluted = JSON.parse('{"x":3,"__proto__":{"p":true}}') as unknown;
    const inherited = Object.create({ x: 9, constructor: "inh" }) as Record<string, unknown>;
    inherited["x"] = 4;
    for (const input of [{ x: 1 }, new Thing(), bare, polluted, inherited, { x: 5, constructor: "c", toString: 7, hasOwnProperty: true }]) {
      const a = C.decode(input);
      const b = Risky.decode(input);
      same(a, b);
      if (a.ok) expect(Object.getPrototypeOf(a.value)).toBe(Object.prototype); // never a polluted prototype
    }
    const r = C.decode(polluted);
    expect(r.ok && Object.hasOwn(r.value, "__proto__") && (r.value as Record<string, unknown>)["__proto__"]).toEqual({ p: true });
  });

  it("lazy / recursive and opaque-only decoders", () => {
    const T = D.compile(Tree);
    for (const input of [{ v: 1, kids: [{ v: 2, kids: [] }] }, { v: "x", kids: [{ v: 2, kids: [{ v: null, kids: [] }] }] }, null]) same(T.decode(input), Tree.decode(input));
    const Opaque = D.map(D.string, (s) => s.length);
    expect(D.compile(Opaque)).toBe(Opaque); // nothing structural: same decoder back
    const prim = D.compile(D.min(D.integer, 3));
    same(prim.decode(2), err({ _tag: "DecodeError", issues: [{ path: [], message: "expected >= 3" }] }));
    same(prim.decode(3), ok(3));
  });

  it("a compiled optional keeps its marker, so it still makes a struct key optional", () => {
    const opt = D.compile(D.optional(D.integer));
    expect(opt.optional).toBe(true);
    const S = D.struct({ a: opt, b: D.string });
    same(S.decode({ b: "x" }), ok({ b: "x" }));
    same(D.compile(S).decode({ b: "x" }), ok({ b: "x" }));
  });

  it("option decodes to the same Option values", () => {
    const Op = D.compile(D.struct({ o: D.option(D.integer) }));
    same(Op.decode({ o: null }), ok({ o: O.none }));
    same(Op.decode({ o: 4 }), ok({ o: O.some(4) }));
    same(Op.decode({ o: "x" }), D.struct({ o: D.option(D.integer) }).decode({ o: "x" }));
  });
});

describe("D.compile falls back when new Function is forbidden (CSP)", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
  it("returns the decoder unchanged", async () => {
    vi.resetModules();
    const blocked = function Function(): never { throw new EvalError("Code generation from strings disallowed for this context"); };
    vi.stubGlobal("Function", blocked);
    const fresh = await import("../src/decode-compile.ts");
    const core = await import("../src/decode-core.ts");
    const S = core.struct({ a: core.integer });
    expect(fresh.compile(S)).toBe(S);
    same(fresh.compile(S).decode({ a: 1 }), ok({ a: 1 }));
  });
});

describe("D.compile: taggedUnion and record are compiled natively (not delegated)", () => {
  const Shape = D.taggedUnion("kind", {
    circle: D.struct({ kind: D.literal("circle"), radius: D.min(D.number, 0) }),
    square: D.struct({ kind: D.literal("square"), side: D.pattern(/^\d+$/) }),
  });
  const Bag = D.record(D.array(Shape));
  const Outer = D.struct({ bag: Bag, one: Shape });
  const C = D.compile(Outer);

  it("matches the interpreter on valid, wrong-tag, non-string-tag, nested-path and risky-key inputs", () => {
    const cases: unknown[] = [
      { bag: { a: [{ kind: "circle", radius: 1 }], b: [] }, one: { kind: "square", side: "12" } },
      { bag: { a: [{ kind: "hexagon" }] }, one: { kind: "circle", radius: -1 } },
      { bag: { a: [{ kind: 7 }] }, one: {} },
      { bag: { constructor: [{ kind: "circle", radius: 2 }], ["__proto__"]: [] }, one: { kind: "square", side: "x" } },
      { bag: [], one: null },
      { bag: { a: [1, { kind: "circle", radius: "r" }] }, one: { kind: "square", side: "3" } },
    ];
    for (const input of cases) same(C.decode(input), Outer.decode(input));
    const r = C.decode({ bag: { a: [{ kind: "hexagon" }] }, one: { kind: "circle", radius: 1 } });
    expect(r.ok ? [] : r.error.issues.map((i) => i.path.join("."))).toEqual(["bag.a.0.kind"]);
    const polluted = C.decode(JSON.parse('{"bag":{"__proto__":[{"kind":"circle","radius":1}]},"one":{"kind":"circle","radius":0}}') as unknown);
    expect(polluted.ok && Object.getPrototypeOf(polluted.value.bag)).toBe(Object.prototype);
    expect(polluted.ok && Object.hasOwn(polluted.value.bag, "__proto__")).toBe(true);
  });

  it("property: identical results for generated bags and arbitrary inputs", () => {
    const arbShape = fc.oneof(fc.record({ kind: fc.constant("circle"), radius: fc.double({ min: 0, noNaN: true, noDefaultInfinity: true }) }), fc.record({ kind: fc.constant("square"), side: fc.stringMatching(/^\d{1,5}$/) }), fc.record({ kind: fc.string() }));
    fc.assert(fc.property(fc.record({ bag: fc.dictionary(fc.string(), fc.array(arbShape, { maxLength: 3 })), one: arbShape }), (v) => { same(C.decode(v), Outer.decode(v)); }), { numRuns: 300 });
    fc.assert(fc.property(fc.anything(), (x) => { same(C.decode(x), Outer.decode(x)); }), { numRuns: 300 });
  });

  it("pattern checks run inline in both engines and keep caller regexes untouched", () => {
    const re = /^a+$/g;
    const P = D.pattern(re);
    const PC = D.compile(D.struct({ p: P }));
    re.lastIndex = 1;
    for (const s of ["aaa", "aab", "", "a"]) same(PC.decode({ p: s }), D.struct({ p: P }).decode({ p: s }));
    expect(re.lastIndex).toBe(1); // the caller's regex state is never touched
    expect(P.decode("aa").ok && P.decode("aa").ok).toBe(true); // a global regex is reset between calls
  });
});
