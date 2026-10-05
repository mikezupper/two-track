import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { R, err, ok, unit, type Result } from "../src/index.ts";

const arbResult = <A>(arb: fc.Arbitrary<A>): fc.Arbitrary<Result<string, A>> =>
  fc.oneof(arb.map(ok), fc.string().map(err));

const eq = <E, A>(a: Result<E, A>, b: Result<E, A>): boolean => JSON.stringify(a) === JSON.stringify(b);

describe("Result constructors and guards", () => {
  it("ok / err / isOk / isErr", () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err("e")).toEqual({ ok: false, error: "e" });
    expect(R.isOk(ok(1))).toBe(true);
    expect(R.isErr(ok(1))).toBe(false);
    expect(R.isErr(err("e"))).toBe(true);
    expect(unit).toEqual({ ok: true, value: undefined });
  });

  it("narrows on the ok discriminant", () => {
    const r: Result<string, number> = Math.random() < 2 ? ok(2) : err("never");
    if (r.ok) expect(r.value + 1).toBe(3);
    else expect(r.error).toBe("never");
  });
});

describe("Result functor laws (fast-check)", () => {
  it("identity: map(r, id) == r", () => {
    fc.assert(fc.property(arbResult(fc.integer()), (r) => eq(R.map(r, (x) => x), r)));
  });
  it("composition: map(map(r, f), g) == map(r, g∘f)", () => {
    fc.assert(
      fc.property(arbResult(fc.integer()), fc.func(fc.integer()), fc.func(fc.string()), (r, f, g) =>
        eq(R.map(R.map(r, f), g), R.map(r, (x) => g(f(x)))),
      ),
    );
  });
});

describe("Result monad laws (fast-check)", () => {
  const arbKleisli = <A, B>(arb: fc.Arbitrary<B>) => fc.func(arbResult(arb)) as fc.Arbitrary<(a: A) => Result<string, B>>;

  it("left identity: andThen(ok(a), f) == f(a)", () => {
    fc.assert(fc.property(fc.integer(), arbKleisli<number, string>(fc.string()), (a, f) => eq(R.andThen(ok(a), f), f(a))));
  });
  it("right identity: andThen(r, ok) == r", () => {
    fc.assert(fc.property(arbResult(fc.integer()), (r) => eq(R.andThen(r, ok), r)));
  });
  it("associativity", () => {
    fc.assert(
      fc.property(
        arbResult(fc.integer()),
        arbKleisli<number, string>(fc.string()),
        arbKleisli<string, boolean>(fc.boolean()),
        (r, f, g) => eq(R.andThen(R.andThen(r, f), g), R.andThen(r, (a) => R.andThen(f(a), g))),
      ),
    );
  });
  it("errors short-circuit: f is never called on the error track", () => {
    let called = 0;
    const r = R.andThen(err("boom"), () => (called++, ok(1)));
    expect(r).toEqual(err("boom"));
    expect(called).toBe(0);
  });
});

describe("Result combinators", () => {
  it("mapErr / mapBoth / orElse / swap / flatten", () => {
    expect(R.mapErr(err(1), (e) => e + 1)).toEqual(err(2));
    expect(R.mapErr(ok(1), (e: number) => e + 1)).toEqual(ok(1));
    expect(R.mapBoth(ok(1), String, (a) => a * 2)).toEqual(ok(2));
    expect(R.mapBoth(err(1), String, (a: number) => a * 2)).toEqual(err("1"));
    expect(R.orElse(err("e"), () => ok(9))).toEqual(ok(9));
    expect(R.orElse(ok(1), () => ok(9))).toEqual(ok(1));
    expect(R.swap(ok(1))).toEqual(err(1));
    expect(R.swap(err(1))).toEqual(ok(1));
    expect(R.flatten(ok(ok(1)))).toEqual(ok(1));
    expect(R.flatten(ok(err("inner")))).toEqual(err("inner"));
    expect(R.flatten(err("outer"))).toEqual(err("outer"));
  });

  it("match / unwrapOr / unwrapOrElse", () => {
    expect(R.match(ok(1), (a) => `ok ${a}`, (e) => `err ${e}`)).toBe("ok 1");
    expect(R.match(err("x"), (a) => `ok ${a}`, (e) => `err ${e}`)).toBe("err x");
    expect(R.unwrapOr(err("x"), 0)).toBe(0);
    expect(R.unwrapOr(ok(5), 0)).toBe(5);
    expect(R.unwrapOrElse(err("x"), (e) => e.length)).toBe(1);
    expect(R.unwrapOrElse(ok(5), (e: string) => e.length)).toBe(5);
  });

  it("tap / tapErr return the same reference", () => {
    const seen: unknown[] = [];
    const o = ok(1);
    const e = err("e");
    expect(R.tap(o, (v) => seen.push(v))).toBe(o);
    expect(R.tap(e, (v) => seen.push(v))).toBe(e);
    expect(R.tapErr(e, (v) => seen.push(v))).toBe(e);
    expect(R.tapErr(o, (v) => seen.push(v))).toBe(o);
    expect(seen).toEqual([1, "e"]);
  });

  it("fromThrowable converts exceptions into typed errors", () => {
    expect(R.fromThrowable(() => JSON.parse("{"), (t) => ({ _tag: "BadJson" as const, cause: t }))).toMatchObject({
      ok: false,
      error: { _tag: "BadJson" },
    });
    expect(R.fromThrowable(() => 42, () => "unreachable")).toEqual(ok(42));
  });

  it("fromPredicate / fromNullable", () => {
    expect(R.fromPredicate(5, (n) => n > 0, (n) => `${n} not positive`)).toEqual(ok(5));
    expect(R.fromPredicate(-1, (n) => n > 0, (n) => `${n} not positive`)).toEqual(err("-1 not positive"));
    expect(R.fromNullable(null, () => "missing")).toEqual(err("missing"));
    expect(R.fromNullable(undefined, () => "missing")).toEqual(err("missing"));
    expect(R.fromNullable(0, () => "missing")).toEqual(ok(0));
  });
});

describe("Result collections", () => {
  it("all: tuple typing and first error wins", () => {
    const r = R.all([ok(1), ok("a"), ok(true)] as const);
    expect(r).toEqual(ok([1, "a", true]));
    if (r.ok) {
      const [n, s, b]: [number, string, boolean] = r.value;
      expect([n, s, b]).toEqual([1, "a", true]);
    }
    expect(R.all([ok(1), err("first"), err("second")])).toEqual(err("first"));
    expect(R.all([])).toEqual(ok([]));
  });

  it("traverse == all(map) (property)", () => {
    const f = (n: number): Result<string, number> => (n % 3 === 0 ? err(`bad ${n}`) : ok(n * 2));
    fc.assert(fc.property(fc.array(fc.integer()), (xs) => eq(R.traverse(xs, f), R.all(xs.map(f)))));
  });

  it("traverse passes the index and stops at the first error", () => {
    const calls: number[] = [];
    const r = R.traverse([10, 20, 30], (x, i) => (calls.push(i), x === 20 ? err("twenty") : ok(x)));
    expect(r).toEqual(err("twenty"));
    expect(calls).toEqual([0, 1]);
  });

  it("validateAll accumulates every error", () => {
    const f = (n: number): Result<string, number> => (n < 0 ? err(`negative ${n}`) : ok(n));
    expect(R.validateAll([1, -2, 3, -4], f)).toEqual(err(["negative -2", "negative -4"]));
    expect(R.validateAll([1, 2], f)).toEqual(ok([1, 2]));
    expect(R.validateAll([], f)).toEqual(ok([]));
  });

  it("validateAll agrees with traverse on success and never loses an error (property)", () => {
    const f = (n: number): Result<number, number> => (n < 0 ? err(n) : ok(n));
    fc.assert(
      fc.property(fc.array(fc.integer()), (xs) => {
        const v = R.validateAll(xs, f);
        const negatives = xs.filter((n) => n < 0);
        const t = R.traverse(xs, f);
        return negatives.length === 0 ? JSON.stringify(v) === JSON.stringify(t) : !v.ok && v.error.length === negatives.length;
      }),
    );
  });

  it("partition never fails", () => {
    expect(R.partition([ok(1), err("a"), ok(2), err("b")])).toEqual({ oks: [1, 2], errs: ["a", "b"] });
  });
});
