import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { constant, identity, pipe } from "../src/index.ts";

describe("fn", () => {
  it("pipe threads values and types", () => {
    const out: string = pipe(2, (n) => n + 1, (n) => n * 2, String);
    expect(out).toBe("6");
    expect(pipe(1)).toBe(1);
    expect(pipe(1, (n) => n + 1, (n) => n + 1, (n) => n + 1, (n) => n + 1, (n) => n + 1, (n) => n + 1, (n) => n + 1)).toBe(8);
  });
  it("identity and constant", () => {
    fc.assert(fc.property(fc.anything(), (x) => Object.is(identity(x), x)));
    expect(constant(3)()).toBe(3);
  });
});
