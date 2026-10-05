import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { D, O, R, ok, some, none, type Option, type Result } from "../src/index.ts";
import {
  arbDecoded,
  arbOption,
  arbResult,
  decoderDoesNotMutate,
  decoderNeverThrows,
  decoderRoundTrip,
  functorLaws,
  monadLaws,
  structuralEq,
  type FastCheckLike,
} from "../src/testing.ts";

// The real module must be assignable to the structural interface with no cast.
const real: FastCheckLike = fc;

describe("two-track/testing accepts the real fast-check", () => {
  it("is assignable without casts", () => {
    expect(typeof real.assert).toBe("function");
  });
});

describe("arbitraries", () => {
  it("arbResult produces both tracks", () => {
    const samples = fc.sample(arbResult(fc, fc.string(), fc.integer()) as fc.Arbitrary<Result<string, number>>, 200);
    expect(samples.some((r) => r.ok)).toBe(true);
    expect(samples.some((r) => !r.ok)).toBe(true);
    expect(samples.every((r) => (r.ok ? typeof r.value === "number" : typeof r.error === "string"))).toBe(true);
  });

  it("arbOption produces both variants", () => {
    const samples = fc.sample(arbOption(fc, fc.integer()) as fc.Arbitrary<Option<number>>, 200);
    expect(samples.some((o) => o.some)).toBe(true);
    expect(samples.some((o) => !o.some)).toBe(true);
    expect(samples.filter((o) => !o.some).every((o) => o === none)).toBe(true);
  });

  it("arbDecoded yields only values the decoder accepts", () => {
    const Qty = D.min(D.integer, 1);
    const arb = arbDecoded(fc, fc.integer({ min: -5, max: 50 }), Qty) as fc.Arbitrary<number>;
    const samples = fc.sample(arb, 200);
    expect(samples.length).toBe(200);
    expect(samples.every((n) => Number.isInteger(n) && n >= 1)).toBe(true);
  });
});

describe("laws against two-track's own types", () => {
  const arbR = arbResult(fc, fc.string(), fc.integer());
  const arbO = arbOption(fc, fc.integer());

  it("Result satisfies the functor and monad laws", () => {
    functorLaws(fc, { arb: arbR, map: (fa, f) => R.map(fa, f) });
    monadLaws(fc, {
      arb: arbR,
      of: (a) => ok<number>(a) as Result<string, number>,
      andThen: (fa, f) => R.andThen(fa, f),
      arbKleisli: arbR.map((fa) => (n: number) => (n % 2 === 0 ? fa : R.ok(n))),
    });
  });

  it("Option satisfies the functor and monad laws", () => {
    functorLaws(fc, { arb: arbO, map: (fa, f) => O.map(fa, f) });
    monadLaws(fc, {
      arb: arbO,
      of: (a) => some<number>(a) as Option<number>,
      andThen: (fa, f) => O.andThen(fa, f),
      arbKleisli: arbO.map((fa) => (n: number) => (n % 2 === 0 ? fa : O.some(n))),
    });
  });

  it("a custom equality is honoured", () => {
    let calls = 0;
    functorLaws(fc, {
      arb: arbO,
      map: (fa, f) => O.map(fa, f),
      equals: (a, b) => {
        calls++;
        return structuralEq(a, b);
      },
    });
    expect(calls).toBeGreaterThan(0);
  });
});

describe("laws detect violations", () => {
  const arbR = arbResult(fc, fc.string(), fc.integer());

  it("a map that perturbs the value fails identity", () => {
    expect(() => functorLaws(fc, { arb: arbR, map: (fa, f) => R.map(fa, (n) => f(n) + 1) })).toThrow();
  });

  it("a map that is not composable fails composition", () => {
    // Applies f twice: map(map(fa,f),g) != map(fa, g∘f) for non-idempotent f.
    expect(() => functorLaws(fc, { arb: arbR, map: (fa, f) => R.map(fa, (n) => f(f(n))) })).toThrow();
  });

  it("an andThen that drops the continuation fails left identity", () => {
    expect(() =>
      monadLaws(fc, {
        arb: arbR,
        of: (a) => ok<number>(a) as Result<string, number>,
        andThen: (fa) => fa,
        arbKleisli: arbR.map((fa) => (n: number) => (n % 2 === 0 ? fa : R.ok(n))),
      }),
    ).toThrow();
  });

  it("an of that wraps the wrong value fails right identity", () => {
    expect(() =>
      monadLaws(fc, {
        arb: arbR,
        of: (a) => ok<number>(a + 1) as Result<string, number>,
        andThen: (fa, f) => R.andThen(fa, f),
        arbKleisli: arbR.map((fa) => (n: number) => (n % 2 === 0 ? fa : R.ok(n))),
      }),
    ).toThrow();
  });
});

describe("decoder properties", () => {
  const Line = D.struct({ sku: D.nonEmptyString, qty: D.min(D.integer, 1), tags: D.array(D.string) });
  const arbLine = fc.record({ sku: fc.string({ minLength: 1 }), qty: fc.integer({ min: 1 }), tags: fc.array(fc.string()) });

  it("round-trips a struct decoder", () => {
    decoderRoundTrip(fc, Line, arbLine);
  });

  it("round-trips with an encode when the wire shape differs", () => {
    const WithGift = D.struct({ sku: D.nonEmptyString, gift: D.option(D.boolean) });
    const arb = fc.record({ sku: fc.string({ minLength: 1 }), gift: fc.oneof(fc.boolean().map((b) => some(b) as Option<boolean>), fc.constant<Option<boolean>>(none)) });
    decoderRoundTrip(fc, WithGift, arb, { encode: (v) => ({ sku: v.sku, gift: O.toNullable(v.gift) }) });
  });

  it("round-trip failure is reported", () => {
    const Trimmed = D.trimmed; // decode changes the value, so identity encode cannot round-trip padded strings
    expect(() => decoderRoundTrip(fc, Trimmed, fc.constant("  padded  "))).toThrow();
  });

  it("never throws and does not mutate for a nested decoder", () => {
    const Order = D.struct({ lines: D.array(Line), note: D.optional(D.string) });
    decoderNeverThrows(fc, Order);
    decoderDoesNotMutate(fc, Order, fc.oneof(fc.record({ lines: fc.array(arbLine) }), fc.anything()));
  });

  it("decoderNeverThrows reports a decoder that throws", () => {
    const throwing = { decode: (): never => { throw new Error("bad decoder"); }, run: (): never => { throw new Error("bad decoder"); } };
    expect(() => decoderNeverThrows(fc, throwing)).toThrow();
  });

  it("structuralEq compares by JSON", () => {
    expect(structuralEq({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(structuralEq({ a: 1 }, { a: 2 })).toBe(false);
  });
});

describe("monadLaws without an explicit arbKleisli", () => {
  it("derives kleisli arrows and still passes for Result and Option", () => {
    monadLaws(fc, { arb: arbResult(fc, fc.string(), fc.integer()), of: R.ok, andThen: R.andThen });
    monadLaws(fc, { arb: arbOption(fc, fc.integer()), of: O.some, andThen: O.andThen });
  });
  it("derived arrows still detect a continuation-dropping andThen", () => {
    expect(() => monadLaws(fc, { arb: arbResult(fc, fc.string(), fc.integer()), of: R.ok, andThen: (fa) => fa })).toThrow();
  });
});
