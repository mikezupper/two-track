import { describe, expect, it } from "vitest";
import { Async, Cap, err, ok, type AsyncResult, type Result } from "../src/index.ts";

const later = <A>(value: A, ms = 0): Promise<A> => new Promise((resolve) => setTimeout(() => resolve(value), ms));

describe("AsyncResult basics", () => {
  it("fromPromise / tryPromise never reject", async () => {
    expect(await Async.fromPromise(Promise.resolve(1), () => "e")).toEqual(ok(1));
    expect(await Async.fromPromise(Promise.reject(new Error("x")), (t) => (t as Error).message)).toEqual(err("x"));
    expect(await Async.tryPromise(() => Promise.resolve(2), () => "e")).toEqual(ok(2));
    expect(await Async.tryPromise(() => { throw new Error("sync"); }, (t) => (t as Error).message)).toEqual(err("sync"));
    expect(await Async.tryPromise(async () => { throw new Error("async"); }, (t) => (t as Error).message)).toEqual(err("async"));
    const seen: AbortSignal[] = [];
    await Async.tryPromise(async (signal) => { seen.push(signal); }, () => "e");
    expect(seen[0]).toBeInstanceOf(AbortSignal);
  });

  it("map / mapErr / andThen / orElse / match / tap / tapErr", async () => {
    const good: AsyncResult<string, number> = Promise.resolve(ok(1));
    const bad: AsyncResult<string, number> = Promise.resolve(err("e"));
    expect(await Async.map(good, (n) => n + 1)).toEqual(ok(2));
    expect(await Async.map(bad, (n) => n + 1)).toEqual(err("e"));
    expect(await Async.mapErr(bad, (e) => e + "!")).toEqual(err("e!"));
    expect(await Async.mapErr(good, (e) => e + "!")).toEqual(ok(1));
    expect(await Async.andThen(good, (n) => ok(n * 10))).toEqual(ok(10));
    expect(await Async.andThen(good, async (n) => err(`bad ${n}`))).toEqual(err("bad 1"));
    expect(await Async.andThen(ok(5), (n) => Promise.resolve(ok(n + 1)))).toEqual(ok(6));
    expect(await Async.andThen(bad, (n) => ok(n))).toEqual(err("e"));
    expect(await Async.orElse(bad, () => ok(0))).toEqual(ok(0));
    expect(await Async.orElse(good, () => ok(0))).toEqual(ok(1));
    expect(await Async.match(good, (n) => `ok${n}`, (e) => `err${e}`)).toBe("ok1");
    expect(await Async.match(bad, (n) => `ok${n}`, (e) => `err${e}`)).toBe("erre");
    const seen: unknown[] = [];
    expect(await Async.tap(good, (n) => { seen.push(n); })).toEqual(ok(1));
    expect(await Async.tap(bad, (n) => { seen.push(n); })).toEqual(err("e"));
    expect(await Async.tapErr(bad, async (e) => { seen.push(e); })).toEqual(err("e"));
    expect(await Async.tapErr(good, async (e) => { seen.push(e); })).toEqual(ok(1));
    expect(seen).toEqual([1, "e"]);
  });

  it("all: first error wins, order preserved", async () => {
    expect(await Async.all([later(ok(1), 5), later(ok(2), 1)])).toEqual(ok([1, 2]));
    expect(await Async.all([later(ok(1), 5), later(err("e"), 1)])).toEqual(err("e"));
  });
});

describe("mapConcurrent", () => {
  it("bounds concurrency and preserves order", async () => {
    let inFlight = 0;
    let peak = 0;
    const r = await Async.mapConcurrent(
      [5, 1, 4, 2, 3, 0],
      async (ms) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await later(undefined, ms);
        inFlight--;
        return ok(ms * 10);
      },
      { concurrency: 2 },
    );
    expect(r).toEqual(ok([50, 10, 40, 20, 30, 0]));
    expect(peak).toBe(2);
  });

  it("fails fast: stops launching and aborts in-flight work", async () => {
    const started: number[] = [];
    const aborted: number[] = [];
    const r = await Async.mapConcurrent(
      [0, 1, 2, 3, 4, 5],
      async (i, _index, signal) => {
        started.push(i);
        if (i === 1) return err(`boom ${i}`);
        await later(undefined, 20);
        if (signal.aborted) aborted.push(i);
        return ok(i);
      },
      { concurrency: 2 },
    );
    expect(r).toEqual(err("boom 1"));
    expect(started.length).toBeLessThan(6);
    expect(aborted).toContain(0);
  });

  it("honours an outer signal and handles sync results, empty input, bad concurrency", async () => {
    expect(await Async.mapConcurrent([], () => ok(1), { concurrency: 4 })).toEqual(ok([]));
    expect(await Async.mapConcurrent([1, 2], (n) => ok(n), { concurrency: 0.5 })).toEqual(ok([1, 2]));
    const c = new AbortController();
    const seen: boolean[] = [];
    const p = Async.mapConcurrent([1, 2, 3], async (n, _i, signal) => { await later(undefined, 10); seen.push(signal.aborted); return ok(n); }, { concurrency: 1, signal: c.signal });
    c.abort();
    await p;
    expect(seen.length).toBeLessThan(3);
  });
});

describe("validateConcurrent", () => {
  it("runs everything and reports all errors", async () => {
    const r = await Async.validateConcurrent([1, 2, 3, 4], async (n) => (n % 2 === 0 ? err(n) : ok(n)), { concurrency: 3 });
    expect(r).toEqual(err([2, 4]));
    expect(await Async.validateConcurrent([1, 3], (n) => ok(n), { concurrency: 3 })).toEqual(ok([1, 3]));
    expect(await Async.validateConcurrent([], (n) => ok(n), { concurrency: 3 })).toEqual(ok([]));
  });
});

describe("retry", () => {
  it("retries transient errors with the policy's delays and stops on success", async () => {
    const sleeper = Cap.instantSleeper();
    let calls = 0;
    const r = await Async.retry(
      async () => (++calls < 3 ? err({ retriable: true, n: calls }) : ok("done")),
      { attempts: 5, delay: Async.backoff({ baseMs: 100 }), retriable: (e) => e.retriable, sleeper },
    );
    expect(r).toEqual(ok("done"));
    expect(calls).toBe(3);
    expect(sleeper.calls).toEqual([100, 200]);
  });

  it("does not retry non-retriable errors and returns the last error after exhausting attempts", async () => {
    const sleeper = Cap.instantSleeper();
    let calls = 0;
    expect(await Async.retry(async () => (calls++, err({ retriable: false })), { attempts: 5, delay: () => 1, retriable: (e) => e.retriable, sleeper })).toEqual(err({ retriable: false }));
    expect(calls).toBe(1);
    calls = 0;
    expect(await Async.retry(() => (calls++, err(`e${calls}`)), { attempts: 3, delay: () => 1, sleeper })).toEqual(err("e3"));
    expect(calls).toBe(3);
    expect(sleeper.calls).toEqual([1, 1]);
  });

  it("stops when the signal is aborted", async () => {
    const sleeper = Cap.instantSleeper();
    const c = new AbortController();
    let calls = 0;
    const r = await Async.retry(async () => { calls++; c.abort(); return err("e"); }, { attempts: 5, delay: () => 1, sleeper, signal: c.signal });
    expect(r).toEqual(err("e"));
    expect(calls).toBe(1);
  });

  it("backoff is exponential, capped, and jittered by an injected random", () => {
    const plain = Async.backoff({ baseMs: 100, factor: 2, maxMs: 350 });
    expect([1, 2, 3, 4].map(plain)).toEqual([100, 200, 350, 350]);
    const jittered = Async.backoff({ baseMs: 100, random: () => 0.5 });
    expect([1, 2].map(jittered)).toEqual([50, 100]);
  });
});

describe("withTimeout", () => {
  it("returns the result when in time and the timeout error otherwise", async () => {
    expect(await Async.withTimeout(async () => ok(1), 50, () => "timeout")).toEqual(ok(1));
    let sawAbort = false;
    const r = await Async.withTimeout(
      (signal) => new Promise<Result<never, string>>((resolve) => { signal.addEventListener("abort", () => { sawAbort = true; resolve(ok("late")); }); }),
      10,
      () => "timeout" as const,
    );
    expect(r).toEqual(err("timeout"));
    expect(sawAbort).toBe(true);
  });

  it("propagates a parent abort without producing a timeout error", async () => {
    const parent = new AbortController();
    const p = Async.withTimeout(
      (signal) => new Promise<Result<string, never>>((resolve) => { signal.addEventListener("abort", () => resolve(err("cancelled"))); }),
      10_000,
      () => "timeout",
      parent.signal,
    );
    parent.abort();
    expect(await p).toEqual(err("cancelled"));
  });
});
