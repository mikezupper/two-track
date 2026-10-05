import { describe, expect, it } from "vitest";
import { checkInvariants, formatViolations } from "../scripts/invariants.ts";

describe("repository invariants (structural tests)", () => {
  it("hold for the current tree", () => {
    const violations = checkInvariants(new URL("..", import.meta.url).pathname);
    expect(formatViolations(violations)).toBe("");
  });
});
