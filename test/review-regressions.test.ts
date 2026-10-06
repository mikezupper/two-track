import fc from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";
import { D, ok, tagged } from "../src/index.ts";

describe("decoder boundary regressions", () => {
  it("accumulates large nested issue lists without overflowing the call stack", () => {
    const invalid = Array.from({ length: 150_000 }, () => "invalid");
    const result = D.array(D.array(D.integer)).decode([invalid, invalid]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected issues");
    expect(result.error.issues).toHaveLength(300_000);
    expect(result.error.issues[0]?.path).toEqual([0, 0]);
    expect(result.error.issues.at(-1)?.path).toEqual([1, 149_999]);
  });

  it("preserves every own record key as data without changing the output prototype", () => {
    fc.assert(fc.property(fc.string(), (value) => {
      const input: unknown = JSON.parse(JSON.stringify({ ["__proto__"]: value, constructor: value, normal: value }));
      const result = D.record(D.string).decode(input);
      expect(result).toEqual(ok(input));
      if (!result.ok) return false;
      expect(Object.keys(result.value)).toEqual(["__proto__", "constructor", "normal"]);
      expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype);
      expect(Object.hasOwn(result.value, "__proto__")).toBe(true);
      return true;
    }));
  });

  it("preserves declared __proto__ struct fields, including object values", () => {
    const value = { injected: true };
    const result = D.struct({ ["__proto__"]: D.struct({ injected: D.boolean }) }).decode({ ["__proto__"]: value });
    expect(result).toEqual(ok({ ["__proto__"]: value }));
    if (!result.ok) throw new Error("expected success");
    expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype);
    expect(Object.hasOwn(result.value, "__proto__")).toBe(true);
  });

  it("treats inherited struct fields as absent", () => {
    const input: unknown = Object.create({ required: "inherited", optional: "inherited" });
    const result = D.struct({ required: D.string, optional: D.optional(D.string) }).decode(input);
    expect(result).toMatchObject({ ok: false, error: { issues: [{ path: ["required"], message: "expected string" }] } });
    expect(D.struct({ optional: D.optional(D.string) }).decode(input)).toEqual(ok({}));
  });

  it.each(["g", "y", "gy"])("pattern is repeatable with %s flags and preserves the caller's regex state", (flags) => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 20 }), (count) => {
      const regex = new RegExp("a+", flags);
      regex.lastIndex = 1;
      const decoder = D.pattern(regex);
      for (let i = 0; i < count; i++) expect(decoder.decode("aaa")).toEqual(ok("aaa"));
      expect(regex.lastIndex).toBe(1);
      expect(decoder.decode("b").ok).toBe(false);
      expect(decoder.decode("aaa")).toEqual(ok("aaa"));
    }));
  });

  it("record errors accumulate at every failing key", () => {
    const result = D.record(D.number).decode({ a: "bad", b: null });
    expect(result).toMatchObject({ ok: false, error: { issues: [
      { path: ["a"], message: "expected finite number" },
      { path: ["b"], message: "expected finite number" },
    ] } });
  });
});

describe("tagged constructor", () => {
  it("the declared tag wins in both the runtime value and its type", () => {
    const constructor = tagged("Expected")<{ _tag: "Other"; value: number }>();
    const result = constructor({ _tag: "Other", value: 1 });
    expectTypeOf(result._tag).toEqualTypeOf<"Expected">();
    expectTypeOf(result.value).toEqualTypeOf<number>();
    expect(result).toEqual({ _tag: "Expected", value: 1 });
  });

  it("keeps its declared tag when a fields object carries a conflicting tag", () => {
    fc.assert(fc.property(fc.string(), (conflict) => {
      expect(tagged("Expected")()({ _tag: conflict })).toEqual({ _tag: "Expected" });
    }));
  });
});
