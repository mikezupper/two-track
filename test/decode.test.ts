import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { D, O, type Brand, type Infer, err, ok } from "../src/index.ts";

const issues = (r: ReturnType<D.Decoder<unknown>["decode"]>) => (r.ok ? [] : r.error.issues.map((i) => `${i.path.join(".")}|${i.message}`));

describe("primitive decoders", () => {
  it("string / number / integer / boolean / literal / unknown", () => {
    expect(D.string.decode("a")).toEqual(ok("a"));
    expect(issues(D.string.decode(1))).toEqual(["|expected string"]);
    expect(D.number.decode(1.5)).toEqual(ok(1.5));
    expect(issues(D.number.decode(Number.NaN))).toEqual(["|expected finite number"]);
    expect(issues(D.number.decode(Number.POSITIVE_INFINITY))).toEqual(["|expected finite number"]);
    expect(D.integer.decode(3)).toEqual(ok(3));
    expect(issues(D.integer.decode(3.5))).toEqual(["|expected integer"]);
    expect(D.boolean.decode(false)).toEqual(ok(false));
    expect(issues(D.boolean.decode("true"))).toEqual(["|expected boolean"]);
    expect(D.literal("a", 1, null).decode(1)).toEqual(ok(1));
    expect(issues(D.literal("a", "b").decode("c"))).toEqual(['|expected one of "a", "b"']);
    expect(D.unknown.decode({ any: 1 })).toEqual(ok({ any: 1 }));
  });

  it("refinements and transforms", () => {
    expect(D.nonEmptyString.decode("")).toMatchObject({ ok: false });
    expect(D.trimmed.decode("  x ")).toEqual(ok("x"));
    expect(D.pattern(/^\d{4}$/).decode("1234")).toEqual(ok("1234"));
    expect(issues(D.pattern(/^\d{4}$/, "expected 4 digits").decode("12"))).toEqual(["|expected 4 digits"]);
    expect(D.minLength(D.string, 2).decode("a")).toMatchObject({ ok: false });
    expect(D.maxLength(D.string, 2).decode("abc")).toMatchObject({ ok: false });
    expect(D.min(D.number, 0).decode(-1)).toMatchObject({ ok: false });
    expect(D.max(D.number, 10).decode(11)).toMatchObject({ ok: false });
    expect(D.map(D.string, (s) => s.length).decode("abc")).toEqual(ok(3));
    expect(D.andThen(D.string, (s) => (s === "x" ? err("no x") : ok(s))).decode("x")).toMatchObject({ ok: false });
    expect(D.andThen(D.string, (s) => ok(s.toUpperCase())).decode("x")).toEqual(ok("X"));
    expect(D.isoDate.decode("2026-10-05T00:00:00Z")).toEqual(ok(new Date("2026-10-05T00:00:00Z")));
    expect(issues(D.isoDate.decode("not a date"))).toEqual(["|expected ISO-8601 date (YYYY-MM-DD) or date-time with Z/±HH:mm offset"]);
    expect(D.custom((u): u is bigint => typeof u === "bigint", "bigint").decode(1n)).toEqual(ok(1n));
    expect(issues(D.custom((u): u is bigint => typeof u === "bigint", "bigint").decode(1))).toEqual(["|expected bigint"]);
  });

  it("brand is a type-only operation", () => {
    const UserId = D.brand(D.pattern(/^u_/), "UserId");
    type UserId = Infer<typeof UserId>;
    const r = UserId.decode("u_1");
    expect(r).toEqual(ok("u_1"));
    if (r.ok) {
      const id: Brand<string, "UserId"> = r.value;
      expect(id).toBe("u_1");
    }
  });
});

describe("containers", () => {
  const Line = D.struct({
    sku: D.nonEmptyString,
    qty: D.min(D.integer, 1),
    note: D.optional(D.string),
    gift: D.option(D.boolean),
  });
  type Line = Infer<typeof Line>;

  it("struct decodes, ignores unknown keys, handles optional and option", () => {
    const r = Line.decode({ sku: "A", qty: 2, extra: true });
    expect(r).toEqual(ok({ sku: "A", qty: 2, gift: O.none }));
    const line: Line = { sku: "A", qty: 1, gift: O.some(true) };
    expect(line.note).toBeUndefined();
    expect(Line.decode({ sku: "A", qty: 1, note: "n", gift: null })).toEqual(ok({ sku: "A", qty: 1, note: "n", gift: O.none }));
    expect(Line.decode({ sku: "A", qty: 1, gift: true })).toEqual(ok({ sku: "A", qty: 1, gift: O.some(true) }));
  });

  it("struct accumulates every issue with paths", () => {
    expect(issues(Line.decode({ sku: "", qty: 0, note: 5 }))).toEqual([
      "sku|expected non-empty string",
      "qty|expected >= 1",
      "note|expected string",
    ]);
    expect(issues(Line.decode(null))).toEqual(["|expected object"]);
    expect(issues(Line.decode([]))).toEqual(["|expected object"]);
  });

  it("array / nonEmptyArray / record / nullable", () => {
    expect(D.array(D.number).decode([1, 2])).toEqual(ok([1, 2]));
    expect(issues(D.array(D.number).decode([1, "x", null]))).toEqual(["1|expected finite number", "2|expected finite number"]);
    expect(issues(D.array(D.number).decode("no"))).toEqual(["|expected array"]);
    expect(D.nonEmptyArray(D.number).decode([1])).toEqual(ok([1]));
    expect(issues(D.nonEmptyArray(D.number).decode([]))).toEqual(["|expected non-empty array"]);
    expect(D.record(D.number).decode({ a: 1, b: 2 })).toEqual(ok({ a: 1, b: 2 }));
    expect(issues(D.record(D.number).decode({ a: 1, b: "x" }))).toEqual(["b|expected finite number"]);
    expect(issues(D.record(D.number).decode([]))).toEqual(["|expected object"]);
    expect(D.nullable(D.number).decode(null)).toEqual(ok(null));
    expect(D.nullable(D.number).decode(1)).toEqual(ok(1));
  });

  it("nested paths are precise", () => {
    const Order = D.struct({ lines: D.array(Line) });
    expect(issues(Order.decode({ lines: [{ sku: "A", qty: 1 }, { sku: "B", qty: "x" }] }))).toEqual(["lines.1.qty|expected integer"]);
  });

  it("taggedUnion picks the variant by discriminant", () => {
    const Shape = D.taggedUnion("kind", {
      circle: D.struct({ kind: D.literal("circle"), radius: D.number }),
      square: D.struct({ kind: D.literal("square"), side: D.number }),
    });
    expect(Shape.decode({ kind: "circle", radius: 1 })).toEqual(ok({ kind: "circle", radius: 1 }));
    expect(issues(Shape.decode({ kind: "square", side: "x" }))).toEqual(["side|expected finite number"]);
    expect(issues(Shape.decode({ kind: "hexagon" }))).toEqual(['kind|expected one of "circle", "square"']);
    expect(issues(Shape.decode({}))).toEqual(['kind|expected one of "circle", "square"']);
    expect(issues(Shape.decode(1))).toEqual(["|expected object"]);
  });

  it("oneOf tries alternatives in order and reports every alternative's issues on failure", () => {
    const d = D.oneOf(D.number, D.literal("n/a"));
    expect(d.decode(1)).toEqual(ok(1));
    expect(d.decode("n/a")).toEqual(ok("n/a"));
    expect(issues(d.decode(true))).toEqual(["|alternative 1: expected finite number", '|alternative 2: expected one of "n/a"']);
    expect(issues(D.oneOf().decode(1))).toEqual(["|expected one of the alternatives"]);
    const nested = D.oneOf(D.struct({ a: D.number }), D.struct({ b: D.string }));
    expect(issues(nested.decode({ a: "x", b: 1 }))).toEqual(["a|alternative 1: expected finite number", "b|alternative 2: expected string"]);
  });

  it("isoDate is strict ISO-8601 with calendar validation; dateFromString is the engine's permissive grammar", () => {
    const okDates = ["2024-02-29", "2026-10-05T12:34Z", "2026-10-05T12:34:56Z", "2026-10-05T12:34:56.789Z", "2026-10-05T12:34:56.123456789Z", "2026-10-05T12:34:56+05:30", "2026-10-05T23:59:59-11:00"];
    for (const s of okDates) {
      const r = D.isoDate.decode(s);
      expect(r.ok, s).toBe(true);
      if (r.ok) expect(r.value.getTime(), s).toBe(new Date(s.replace(/\.(\d{3})\d+/, ".$1")).getTime());
    }
    expect(D.isoDate.decode("2026-10-05")).toEqual(ok(new Date("2026-10-05T00:00:00Z")));
    const bad: Array<[string, string]> = [
      ["2023-02-30", "expected a valid calendar date"],
      ["2023-02-29", "expected a valid calendar date"],
      ["2023-04-31", "expected a valid calendar date"],
      ["2023-13-01", "expected a valid calendar date"],
      ["2023-00-10", "expected a valid calendar date"],
      ["2026-10-05T24:00:00Z", "expected a valid time of day"],
      ["2026-10-05T12:60:00Z", "expected a valid time of day"],
      ["2026-10-05T12:00:60Z", "expected a valid time of day"],
      ["2026-10-05T12:00:00+24:00", "expected a valid UTC offset"],
      ["2026-10-05T12:00:00", "expected ISO-8601 date (YYYY-MM-DD) or date-time with Z/±HH:mm offset"],
      ["March 5, 2020", "expected ISO-8601 date (YYYY-MM-DD) or date-time with Z/±HH:mm offset"],
      ["2026-10-05 12:00:00Z", "expected ISO-8601 date (YYYY-MM-DD) or date-time with Z/±HH:mm offset"],
      ["20261005", "expected ISO-8601 date (YYYY-MM-DD) or date-time with Z/±HH:mm offset"],
    ];
    for (const [s, message] of bad) expect(issues(D.isoDate.decode(s)), s).toEqual([`|${message}`]);
    // the permissive decoder is explicit about being permissive
    expect(D.dateFromString.decode("March 5, 2020").ok).toBe(true);
    expect(D.dateFromString.decode("2023-02-30").ok).toBe(true); // normalized by the engine — that is why it is not isoDate
    expect(issues(D.dateFromString.decode("nope"))).toEqual(["|expected a date string"]);
  });

  it("isoDate round-trips every Date (property)", () => {
    fc.assert(
      fc.property(fc.date({ min: new Date("0001-01-01T00:00:00Z"), max: new Date("9999-12-31T23:59:59.999Z"), noInvalidDate: true }), (d) => {
        const r = D.isoDate.decode(d.toISOString());
        return r.ok && r.value.getTime() === d.getTime();
      }),
    );
  });

  it("json parses then decodes", () => {
    const d = D.json(D.struct({ a: D.number }));
    expect(d.decode('{"a":1}')).toEqual(ok({ a: 1 }));
    expect(issues(d.decode("{"))).toEqual(["|expected valid JSON"]);
    expect(issues(d.decode(1))).toEqual(["|expected JSON string"]);
    expect(issues(d.decode('{"a":"x"}'))).toEqual(["a|expected finite number"]);
  });

  it("lazy supports recursive shapes", () => {
    type Tree = { readonly value: number; readonly children: Tree[] };
    const Tree: D.Decoder<Tree> = D.lazy(() => D.struct({ value: D.number, children: D.array(Tree) }));
    expect(Tree.decode({ value: 1, children: [{ value: 2, children: [] }] })).toEqual(ok({ value: 1, children: [{ value: 2, children: [] }] }));
    expect(issues(Tree.decode({ value: 1, children: [{ value: "x", children: [] }] }))).toEqual(["children.0.value|expected finite number"]);
  });

  it("formatIssues renders paths", () => {
    const r = D.struct({ a: D.array(D.number) }).decode({ a: [1, "x"] });
    expect(r.ok ? "" : D.formatIssues(r.error)).toBe("a.1: expected finite number");
    const root = D.number.decode("x");
    expect(root.ok ? "" : D.formatIssues(root.error)).toBe("$: expected finite number");
  });
});

describe("decoder properties (fast-check)", () => {
  it("round-trip: any value the generator produces decodes to itself", () => {
    const Line = D.struct({ sku: D.nonEmptyString, qty: D.min(D.integer, 1), tags: D.array(D.string) });
    const arb = fc.record({ sku: fc.string({ minLength: 1 }), qty: fc.integer({ min: 1 }), tags: fc.array(fc.string()) });
    fc.assert(fc.property(arb, (v) => JSON.stringify(Line.decode(v)) === JSON.stringify(ok(v))));
  });

  it("JSON round-trip through the json decoder", () => {
    const Doc = D.struct({ n: D.number, s: D.string, b: D.boolean, xs: D.array(D.integer) });
    const arb = fc.record({ n: fc.double({ noNaN: true, noDefaultInfinity: true }), s: fc.string(), b: fc.boolean(), xs: fc.array(fc.integer()) });
    fc.assert(fc.property(arb, (v) => JSON.stringify(D.json(Doc).decode(JSON.stringify(v))) === JSON.stringify(ok(v))));
  });

  it("the success path never mutates its input", () => {
    const Line = D.struct({ a: D.number, b: D.array(D.string) });
    fc.assert(
      fc.property(fc.record({ a: fc.integer(), b: fc.array(fc.string()) }), (v) => {
        const before = JSON.stringify(v);
        Line.decode(v);
        return JSON.stringify(v) === before;
      }),
    );
  });

  it("decoders never throw, whatever the input", () => {
    const Any = D.struct({ a: D.array(D.taggedUnion("k", { x: D.struct({ k: D.literal("x"), n: D.integer }) })), o: D.option(D.isoDate) });
    fc.assert(fc.property(fc.anything(), (v) => typeof Any.decode(v).ok === "boolean"));
  });
});
