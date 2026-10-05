import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { O, none, some, type Option } from "../src/index.ts";

const arbOption = <A>(arb: fc.Arbitrary<A>): fc.Arbitrary<Option<A>> => fc.oneof(arb.map(some), fc.constant(none));
const eq = <A>(a: Option<A>, b: Option<A>): boolean => JSON.stringify(a) === JSON.stringify(b);

describe("Option", () => {
  it("none is a shared singleton", () => {
    expect(O.map(none, (x: number) => x + 1)).toBe(none);
    expect(O.fromNullable(null)).toBe(none);
    expect(O.fromNullable(undefined)).toBe(none);
  });

  it("functor and monad laws", () => {
    fc.assert(fc.property(arbOption(fc.integer()), (o) => eq(O.map(o, (x) => x), o)));
    fc.assert(
      fc.property(arbOption(fc.integer()), fc.func(fc.integer()), fc.func(fc.string()), (o, f, g) =>
        eq(O.map(O.map(o, f), g), O.map(o, (x) => g(f(x)))),
      ),
    );
    const k = fc.func(arbOption(fc.string())) as fc.Arbitrary<(n: number) => Option<string>>;
    fc.assert(fc.property(fc.integer(), k, (a, f) => eq(O.andThen(some(a), f), f(a))));
    fc.assert(fc.property(arbOption(fc.integer()), (o) => eq(O.andThen(o, some), o)));
  });

  it("combinators", () => {
    expect(O.isSome(some(1))).toBe(true);
    expect(O.isNone(some(1))).toBe(false);
    expect(O.isNone(none)).toBe(true);
    expect(O.orElse(none, () => some(2))).toEqual(some(2));
    expect(O.orElse(some(1), () => some(2))).toEqual(some(1));
    expect(O.filter(some(3), (n) => n > 2)).toEqual(some(3));
    expect(O.filter(some(1), (n) => n > 2)).toBe(none);
    expect(O.match(some(1), (n) => n * 2, () => 0)).toBe(2);
    expect(O.match(none, (n: number) => n * 2, () => 0)).toBe(0);
    expect(O.unwrapOr(none, "d")).toBe("d");
    expect(O.unwrapOr(some("v"), "d")).toBe("v");
    expect(O.unwrapOrElse(none, () => "d")).toBe("d");
    expect(O.unwrapOrElse(some("v"), () => "d")).toBe("v");
    expect(O.toNullable(none)).toBeNull();
    expect(O.toNullable(some(1))).toBe(1);
    expect(O.toUndefined(none)).toBeUndefined();
    expect(O.toUndefined(some(1))).toBe(1);
    expect(O.toResult(none, () => "missing")).toEqual({ ok: false, error: "missing" });
    expect(O.toResult(some(1), () => "missing")).toEqual({ ok: true, value: 1 });
    expect(O.all([some(1), some(2)])).toEqual(some([1, 2]));
    expect(O.all([some(1), none])).toBe(none);
    expect(O.find([1, 2, 3], (n) => n > 1)).toEqual(some(2));
    expect(O.find([1, 2, 3], (n) => n > 5)).toBe(none);
  });

  it("fromNullable keeps falsy non-null values", () => {
    expect(O.fromNullable(0)).toEqual(some(0));
    expect(O.fromNullable("")).toEqual(some(""));
    expect(O.fromNullable(false)).toEqual(some(false));
  });
});
