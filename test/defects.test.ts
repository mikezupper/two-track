import { describe, expect, it } from "vitest";
import { Async, Lane, err, match, matchBy, ok, type AsyncResult, type Result } from "../src/index.ts";

const later = <A>(value: A, ms: number): Promise<A> => new Promise((resolve) => setTimeout(() => resolve(value), ms));

describe("defects closed after the project review", () => {
  it("semaphore: a run that throws (a defect) still releases its permit and the rejection surfaces", async () => {
    const s = Lane.semaphore(1);
    await expect(s.run(async () => { throw new Error("defect"); })).rejects.toThrow("defect");
    expect(s.available()).toBe(1);
    await expect(s.run(() => { throw new Error("sync defect"); })).rejects.toThrow("sync defect"); // synchronous throw too
    expect(s.available()).toBe(1);
    expect(await s.run(async () => ok("still works"))).toEqual(ok("still works"));
  });

  it("mapConcurrent: a rejecting f (a defect) aborts siblings, removes the outer listener, and rejects", async () => {
    const c = new AbortController();
    let adds = 0;
    let removes = 0;
    const add = c.signal.addEventListener.bind(c.signal);
    const remove = c.signal.removeEventListener.bind(c.signal);
    c.signal.addEventListener = ((...a: Parameters<AbortSignal["addEventListener"]>) => { adds++; add(...a); }) as AbortSignal["addEventListener"];
    c.signal.removeEventListener = ((...a: Parameters<AbortSignal["removeEventListener"]>) => { removes++; remove(...a); }) as AbortSignal["removeEventListener"];
    const seenAbort: number[] = [];
    const p = Async.mapConcurrent(
      [1, 2, 3, 4],
      async (n, _i, signal) => {
        if (n === 2) throw new Error("defect in item 2");
        await later(undefined, 10);
        if (signal.aborted) seenAbort.push(n);
        return ok(n);
      },
      { concurrency: 2, signal: c.signal },
    );
    await expect(p).rejects.toThrow("defect in item 2");
    expect({ adds, removes }).toEqual({ adds: 1, removes: 1 });
    expect(seenAbort).toContain(1); // the sibling in flight saw the abort
  });

  it("validateConcurrent: no new item starts after an outer abort; the outcome is Aborted", async () => {
    const c = new AbortController();
    let launched = 0;
    const r: Result<readonly [string, ...string[]] | Async.Aborted, number[]> = await Async.validateConcurrent(
      [1, 2, 3, 4, 5],
      async (n) => {
        launched++;
        await later(undefined, 2);
        if (n === 1) c.abort();
        return n === 3 ? err("three") : ok(n);
      },
      { concurrency: 1, signal: c.signal },
    );
    expect(r).toEqual(err({ _tag: "Aborted" }));
    expect(launched).toBe(1);
    const pre = new AbortController();
    pre.abort();
    expect(await Async.validateConcurrent([1], async (n) => ok(n), { concurrency: 1, signal: pre.signal })).toEqual(err({ _tag: "Aborted" }));
    // without a signal the type has no Aborted and behaviour is unchanged
    const plain: Result<readonly [number, ...number[]], number[]> = await Async.validateConcurrent([1, 2, 3], async (n) => (n === 2 ? err(n) : ok(n)), { concurrency: 2 });
    expect(plain).toEqual(err([2]));
    // an abort that arrives after the last item was already launched still yields a complete report
    const late = new AbortController();
    const full: AsyncResult<readonly [number, ...number[]] | Async.Aborted, number[]> = Async.validateConcurrent([1, 2], async (n) => { await later(undefined, 5); return ok(n); }, { concurrency: 2, signal: late.signal });
    await later(undefined, 1);
    late.abort();
    expect(await full).toEqual(ok([1, 2]));
  });

  it("match / matchBy: a tag the type forbids is a clear defect, not a TypeError", () => {
    const lied = { _tag: "Nope" } as unknown as { _tag: "A" };
    expect(() => match(lied, { A: () => 1 })).toThrow(/no case for _tag "Nope" \(cases: A\)/);
    const liedKind = { kind: "x" } as unknown as { kind: "circle" };
    expect(() => matchBy("kind", liedKind, { circle: () => 1 })).toThrow(/no case for kind "x" \(cases: circle\)/);
    expect(match({ _tag: "A" as const }, { A: () => 1 })).toBe(1);
  });
});

describe("semaphore queue complexity (found by bench/lanes.ts)", () => {
  it("200k waiters drain in linear time: shift()/indexOf were quadratic on V8", async () => {
    const sem = Lane.semaphore(1);
    const gate = new Promise<Result<never, number>>((resolve) => setTimeout(() => resolve(ok(0)), 1));
    const first = sem.run(() => gate);
    const n = 200_000;
    const t0 = performance.now();
    const rest = Array.from({ length: n }, (_, i) => sem.run(async () => ok(i)));
    await first;
    const results = await Promise.all(rest);
    const elapsed = performance.now() - t0;
    expect(results.every((r, i) => r.ok && r.value === i)).toBe(true); // FIFO preserved
    expect(sem.available()).toBe(1);
    expect(elapsed).toBeLessThan(5_000); // quadratic took ~20 s; linear is well under a second
  });

  it("aborted waiters are tombstoned, skipped in O(1), and never granted", async () => {
    const sem = Lane.semaphore(1);
    const hold = new Promise<Result<never, string>>((resolve) => setTimeout(() => resolve(ok("held")), 2));
    const holder = sem.run(() => hold);
    const controllers = Array.from({ length: 5_000 }, () => new AbortController());
    const waiters = controllers.map((c, i) => sem.run(async () => ok(i), c.signal));
    controllers.forEach((c, i) => { if (i % 2 === 0) c.abort(); });
    const last = sem.run(async () => ok("last"));
    expect(await holder).toEqual(ok("held"));
    const settled = await Promise.all(waiters);
    expect(settled.filter((r) => !r.ok).length).toBe(2_500);
    expect(settled.filter((r) => r.ok).length).toBe(2_500);
    expect(await last).toEqual(ok("last"));
    expect(sem.available()).toBe(1);
  });
});
