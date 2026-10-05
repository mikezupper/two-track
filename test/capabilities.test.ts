import { describe, expect, it } from "vitest";
import { Cap } from "../src/index.ts";

describe("capabilities", () => {
  it("system implementations are wired to the platform", async () => {
    expect(Math.abs(Cap.systemClock.now() - Date.now())).toBeLessThan(1000);
    const r = Cap.systemRandom.next();
    expect(r >= 0 && r < 1).toBe(true);
    expect(Cap.systemIdGen.next()).toMatch(/^[0-9a-f-]{36}$/);
    await Cap.systemSleeper.sleep(1);
    const c = new AbortController();
    c.abort();
    await Cap.systemSleeper.sleep(10_000, c.signal); // resolves immediately when already aborted
    const c2 = new AbortController();
    const p = Cap.systemSleeper.sleep(10_000, c2.signal);
    c2.abort();
    await p; // resolves promptly on abort
  });

  it("controlledClock only moves on demand", () => {
    const clock = Cap.controlledClock(100);
    expect(clock.now()).toBe(100);
    clock.advance(50);
    expect(clock.now()).toBe(150);
    clock.set(7);
    expect(clock.now()).toBe(7);
  });

  it("instantSleeper records delays without waiting", async () => {
    const s = Cap.instantSleeper();
    await s.sleep(500);
    await s.sleep(1500);
    expect(s.calls).toEqual([500, 1500]);
  });

  it("seededRandom is deterministic and in range", () => {
    const a = Cap.seededRandom(42);
    const b = Cap.seededRandom(42);
    const xs = Array.from({ length: 1000 }, () => a.next());
    const ys = Array.from({ length: 1000 }, () => b.next());
    expect(xs).toEqual(ys);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(new Set(xs).size).toBeGreaterThan(900);
  });

  it("sequentialIds", () => {
    const ids = Cap.sequentialIds("o-");
    expect([ids.next(), ids.next()]).toEqual(["o-1", "o-2"]);
    expect(Cap.sequentialIds().next()).toBe("id-1");
  });
});
