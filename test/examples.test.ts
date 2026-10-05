import { describe, expect, it } from "vitest";
import { checkout, fakeDeps, toResponse } from "../examples/checkout.ts";

describe("examples/checkout", () => {
  it("happy path: prices, reserves, retries a transient decline, places the order", async () => {
    const deps = fakeDeps({ "ABC-123": 5 }, 1);
    const r = await checkout(deps, { userId: "u1", lines: [{ sku: "ABC-123", qty: 2 }], coupon: "SAVE10" });
    expect(r).toMatchObject({ ok: true, value: { id: "order-1", total: 3598, placedAt: 1_700_000_000_000 } });
    expect(deps.charges).toEqual([3598]);
    expect(toResponse(r).status).toBe(201);
  });

  it("boundary: every decode issue is reported at once", async () => {
    const r = await checkout(fakeDeps({}), { userId: "", lines: [{ sku: "nope", qty: 0 }] });
    expect(toResponse(r)).toEqual({ status: 400, body: { error: "invalid", issues: "userId: expected non-empty string; lines.0.sku: expected SKU like ABC-123; lines.0.qty: expected >= 1" } });
  });

  it("error tracks: unknown sku, insufficient stock, payment declined", async () => {
    expect(toResponse(await checkout(fakeDeps({}), { userId: "u1", lines: [{ sku: "QQQ-000", qty: 1 }] })).status).toBe(422);
    expect(toResponse(await checkout(fakeDeps({ "ABC-123": 1 }), { userId: "u1", lines: [{ sku: "ABC-123", qty: 2 }] })).status).toBe(409);
    const deps = fakeDeps({ "ABC-123": 9 }, 5);
    expect(toResponse(await checkout(deps, { userId: "u1", lines: [{ sku: "ABC-123", qty: 1 }] })).status).toBe(402);
    expect(deps.charges).toEqual([]);
  });
});
