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

describe("manualSleeper", () => {
  it("fires timers only on demand, in call order or by index", async () => {
    const s = Cap.manualSleeper();
    const done: string[] = [];
    void s.sleep(100).then(() => done.push("a"));
    void s.sleep(200).then(() => done.push("b"));
    void s.sleep(300).then(() => done.push("c"));
    expect(s.pending()).toEqual([100, 200, 300]);
    await Promise.resolve();
    expect(done).toEqual([]);
    s.fire(1);
    await Promise.resolve();
    expect(done).toEqual(["b"]);
    expect(s.pending()).toEqual([100, 300]);
    s.fire();
    await Promise.resolve();
    expect(done).toEqual(["b", "a"]);
    s.fireAll();
    await Promise.resolve();
    expect(done).toEqual(["b", "a", "c"]);
    expect(s.pending()).toEqual([]);
    s.fire(5); // out of range: no-op
  });

  it("an aborted signal resolves the sleep immediately and removes it from pending", async () => {
    const s = Cap.manualSleeper();
    const c = new AbortController();
    let resolved = false;
    const p = s.sleep(50, c.signal).then(() => {
      resolved = true;
    });
    expect(s.pending()).toEqual([50]);
    c.abort();
    await p;
    expect(resolved).toBe(true);
    expect(s.pending()).toEqual([]);
    const already = new AbortController();
    already.abort();
    await s.sleep(10, already.signal);
    expect(s.pending()).toEqual([]);
  });
});
