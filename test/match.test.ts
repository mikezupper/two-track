import { describe, expect, it } from "vitest";
import { assertNever, hasTag, match, matchBy, tagged, type Tagged } from "../src/index.ts";

type Draft = Tagged<"Draft", { items: number }>;
type Paid = Tagged<"Paid", { receipt: string }>;
type Shipped = Tagged<"Shipped", { tracking: string }>;
type OrderState = Draft | Paid | Shipped;

const describeState = (s: OrderState): string =>
  match(s, {
    Draft: ({ items }) => `draft(${items})`,
    Paid: ({ receipt }) => `paid(${receipt})`,
    Shipped: ({ tracking }) => `shipped(${tracking})`,
  });

describe("match", () => {
  it("dispatches on _tag with narrowed payloads", () => {
    expect(describeState({ _tag: "Draft", items: 2 })).toBe("draft(2)");
    expect(describeState({ _tag: "Paid", receipt: "r1" })).toBe("paid(r1)");
    expect(describeState({ _tag: "Shipped", tracking: "t" })).toBe("shipped(t)");
  });

  it("is exhaustive at compile time", () => {
    // @ts-expect-error — missing the Shipped case must not compile
    const partial = (s: OrderState) => match(s, { Draft: () => 1, Paid: () => 2 });
    expect(typeof partial).toBe("function");
  });

  it("matchBy uses a custom discriminant", () => {
    type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
    const area = (s: Shape) => matchBy("kind", s, { circle: ({ r }) => Math.PI * r * r, square: ({ side }) => side * side });
    expect(area({ kind: "square", side: 3 })).toBe(9);
    expect(area({ kind: "circle", r: 1 })).toBeCloseTo(Math.PI);
    // @ts-expect-error — missing square
    const partial = (s: Shape) => matchBy("kind", s, { circle: () => 0 });
    expect(typeof partial).toBe("function");
  });

  it("assertNever proves switch exhaustiveness and throws if reached", () => {
    const label = (s: OrderState): string => {
      switch (s._tag) {
        case "Draft":
          return "d";
        case "Paid":
          return "p";
        case "Shipped":
          return "s";
        default:
          return assertNever(s, "OrderState");
      }
    };
    expect(label({ _tag: "Paid", receipt: "" })).toBe("p");
    expect(() => assertNever({ _tag: "Lied" } as never, "test")).toThrow(/assertNever reached \(test\)/);
  });
});

describe("tagged", () => {
  it("builds constructors and guards", () => {
    const OrderNotFound = tagged("OrderNotFound")<{ orderId: string }>();
    const e = OrderNotFound({ orderId: "o1" });
    expect(e).toEqual({ _tag: "OrderNotFound", orderId: "o1" });
    const Timeout = tagged("Timeout")();
    expect(Timeout({})).toEqual({ _tag: "Timeout" });
    const isNotFound = hasTag("OrderNotFound");
    const u: ReturnType<typeof OrderNotFound> | ReturnType<typeof Timeout> = e;
    expect(isNotFound(u)).toBe(true);
    if (isNotFound(u)) expect(u.orderId).toBe("o1");
    expect(isNotFound(Timeout({}))).toBe(false);
  });
});
