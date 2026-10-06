import { describe, expect, it } from "vitest";
import { Cap, Lane, err, ok, type AsyncResult, type Result } from "../src/index.ts";

type Deferred<T> = { readonly promise: Promise<T>; readonly resolve: (value: T) => void };
const deferred = <T>(): Deferred<T> => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
/** Lets queued microtasks/macrotasks settle. The only timer in this file. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 1));

type Boom = { readonly _tag: "Boom"; readonly n: number };
const boom = (n: number): Boom => ({ _tag: "Boom", n });

describe("switchLane", () => {
  it("supersedes the previous in-flight call immediately, even if its run ignores the signal", async () => {
    const first = deferred<Result<Boom, string>>();
    const second = deferred<Result<Boom, string>>();
    const runs: Array<{ n: number; signal: AbortSignal }> = [];
    const lane = Lane.switchLane((signal, n: number) => {
      runs.push({ n, signal });
      return n === 1 ? first.promise : second.promise;
    });
    const p1: AsyncResult<Boom | Lane.Superseded, string> = lane(1);
    const p2 = lane(2);
    expect(await p1).toEqual(err({ _tag: "Superseded" })); // resolved without first.resolve
    expect(runs[0]?.signal.aborted).toBe(true);
    expect(runs[1]?.signal.aborted).toBe(false);
    second.resolve(ok("two"));
    expect(await p2).toEqual(ok("two"));
    first.resolve(ok("late")); // ignored
    expect(await p1).toEqual(err({ _tag: "Superseded" }));
  });

  it("passes the run's own error through and clears state after completion", async () => {
    const lane = Lane.switchLane(async (_signal, n: number) => (n < 0 ? err(boom(n)) : ok(n)));
    expect(await lane(-1)).toEqual(err(boom(-1)));
    expect(await lane(3)).toEqual(ok(3));
  });

  it("lane-level abort supersedes the current call and rejects new ones", async () => {
    const c = new AbortController();
    const pending = deferred<Result<never, number>>();
    const lane = Lane.switchLane(() => pending.promise, { signal: c.signal });
    const p = lane();
    c.abort();
    expect(await p).toEqual(err({ _tag: "Superseded" }));
    expect(await lane()).toEqual(err({ _tag: "Superseded" }));
  });
});

describe("exhaustLane", () => {
  it("rejects calls while one is in flight, then accepts again", async () => {
    const gate = deferred<Result<never, string>>();
    let started = 0;
    const lane = Lane.exhaustLane(() => {
      started++;
      return gate.promise;
    });
    const p1: AsyncResult<Lane.Busy, string> = lane();
    expect(await lane()).toEqual(err({ _tag: "Busy" }));
    expect(started).toBe(1);
    gate.resolve(ok("done"));
    expect(await p1).toEqual(ok("done"));
    const again = Lane.exhaustLane(async () => ok("again"));
    expect(await again()).toEqual(ok("again"));
    expect(await lane()).toEqual(ok("done")); // gate already resolved; a new run starts and completes
    expect(started).toBe(2);
  });

  it("delivers a lane-level abort through the signal and passes the run's result through", async () => {
    const c = new AbortController();
    let seen: AbortSignal | undefined;
    const lane = Lane.exhaustLane(
      async (signal, n: number) => {
        seen = signal;
        await tick();
        return n === 0 ? err(boom(0)) : ok(n);
      },
      { signal: c.signal },
    );
    const p = lane(0);
    c.abort();
    expect(await p).toEqual(err(boom(0)));
    expect(seen?.aborted).toBe(true);
    expect(await lane(1)).toEqual(err({ _tag: "Busy" })); // lane aborted: nothing more starts
  });
});

describe("queueLane", () => {
  it.each([Number.NaN, -1, 0.5, 1.5])("normalizes depth %s to a nonnegative whole number", async (depth) => {
    const normalized = Math.max(0, Math.floor(depth) || 0);
    const gate = deferred<Result<never, number>>();
    const lane = Lane.queueLane(() => gate.promise, { depth });
    const accepted = Array.from({ length: normalized + 1 }, () => lane());
    expect(await lane()).toEqual(err({ _tag: "QueueFull", depth: normalized }));
    gate.resolve(ok(1));
    expect(await Promise.all(accepted)).toEqual(accepted.map(() => ok(1)));
  });

  it("runs strictly in order, one at a time, and a failure does not stop later calls", async () => {
    const order: string[] = [];
    let inFlight = 0;
    let peak = 0;
    const lane = Lane.queueLane(async (_signal, n: number) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      order.push(`start ${n}`);
      await tick();
      order.push(`end ${n}`);
      inFlight--;
      return n === 2 ? err(boom(2)) : ok(n);
    });
    const results = await Promise.all([lane(1), lane(2), lane(3)]);
    expect(results).toEqual([ok(1), err(boom(2)), ok(3)]);
    expect(order).toEqual(["start 1", "end 1", "start 2", "end 2", "start 3", "end 3"]);
    expect(peak).toBe(1);
  });

  it("rejects with QueueFull beyond depth and accepts again once the queue drains", async () => {
    const gate = deferred<Result<never, number>>();
    const lane = Lane.queueLane((_signal, n: number) => (n === 1 ? gate.promise : Promise.resolve(ok(n))), { depth: 1 });
    const p1: AsyncResult<Lane.QueueFull | Lane.Busy, number> = lane(1);
    const p2 = lane(2);
    expect(await lane(3)).toEqual(err({ _tag: "QueueFull", depth: 1 }));
    gate.resolve(ok(1));
    expect(await p1).toEqual(ok(1));
    expect(await p2).toEqual(ok(2));
    expect(await lane(4)).toEqual(ok(4));
  });

  it("depth 0 still runs a call when idle; a lane-level abort makes waiting calls resolve Busy promptly and never start", async () => {
    const c = new AbortController();
    const gate = deferred<Result<never, string>>();
    const started: number[] = [];
    const lane = Lane.queueLane(
      (signal, n: number) => {
        started.push(n);
        return n === 1 ? gate.promise : Promise.resolve(ok(`r${n}`));
      },
      { depth: 0, signal: c.signal },
    );
    const p1 = lane(1);
    expect(await lane(2)).toEqual(err({ _tag: "QueueFull", depth: 0 }));
    const lane2 = Lane.queueLane((signal, n: number) => {
      started.push(n * 10);
      return n === 1 ? gate.promise : Promise.resolve(ok(`q${n}`));
    }, { signal: c.signal });
    const q1 = lane2(1);
    const q2 = lane2(2);
    await tick(); // q1 has started; q2 is still queued
    c.abort();
    const q3 = lane2(3); // after the abort: rejected immediately
    expect(await q3).toEqual(err({ _tag: "Busy" }));
    gate.resolve(ok("g"));
    expect(await p1).toEqual(ok("g"));
    expect(await q1).toEqual(ok("g"));
    expect(await q2).toEqual(err({ _tag: "Busy" })); // was waiting: never started
    expect(started).toEqual([1, 10]);
    const typed: AsyncResult<Lane.QueueFull | Lane.Busy, string> = lane2(4);
    expect(await typed).toEqual(err({ _tag: "Busy" }));
  });
});

describe("debounce", () => {
  it("only the last call in a burst runs, after the quiet period; the others are Superseded", async () => {
    const sleeper = Cap.manualSleeper();
    const ran: number[] = [];
    const lane = Lane.debounce(
      async (_signal, n: number): AsyncResult<never, number> => {
        ran.push(n);
        return ok(n * 10);
      },
      100,
      { sleeper },
    );
    const p1: AsyncResult<Lane.Superseded, number> = lane(1);
    const p2 = lane(2);
    const p3 = lane(3);
    expect(await p1).toEqual(err({ _tag: "Superseded" }));
    expect(await p2).toEqual(err({ _tag: "Superseded" }));
    expect(sleeper.pending()).toEqual([100]);
    expect(ran).toEqual([]);
    sleeper.fire();
    expect(await p3).toEqual(ok(30));
    expect(ran).toEqual([3]);
  });

  it("a call arriving while a run is executing starts a new quiet period without cancelling the run", async () => {
    const sleeper = Cap.manualSleeper();
    const gate = deferred<Result<Boom, string>>();
    const seen: AbortSignal[] = [];
    const lane = Lane.debounce(
      (signal, n: number) => {
        seen.push(signal);
        return n === 1 ? gate.promise : Promise.resolve(ok(`n${n}`));
      },
      50,
      { sleeper },
    );
    const p1 = lane(1);
    sleeper.fire();
    await tick();
    const p2 = lane(2);
    expect(sleeper.pending()).toEqual([50]);
    expect(seen[0]?.aborted).toBe(false);
    gate.resolve(err(boom(1)));
    expect(await p1).toEqual(err(boom(1)));
    sleeper.fire();
    expect(await p2).toEqual(ok("n2"));
  });

  it("lane-level abort supersedes a pending wait", async () => {
    const sleeper = Cap.manualSleeper();
    const c = new AbortController();
    const lane = Lane.debounce(async () => ok(1), 10, { sleeper, signal: c.signal });
    const p = lane();
    c.abort();
    expect(await p).toEqual(err({ _tag: "Superseded" }));
    expect(sleeper.pending()).toEqual([]);
  });
});

describe("throttle", () => {
  it("runs the first call, rejects calls inside the window, accepts after it", async () => {
    const clock = Cap.controlledClock(1_000);
    const ran: number[] = [];
    const lane = Lane.throttle(
      async (_signal, n: number) => {
        ran.push(n);
        return n === 9 ? err(boom(9)) : ok(n);
      },
      100,
      { clock },
    );
    const r1: Result<Boom | Lane.Busy, number> = await lane(1);
    expect(r1).toEqual(ok(1));
    clock.advance(99);
    expect(await lane(2)).toEqual(err({ _tag: "Busy" }));
    clock.advance(1);
    expect(await lane(9)).toEqual(err(boom(9)));
    expect(ran).toEqual([1, 9]);
  });

  it("a lane-level abort stops new runs", async () => {
    const c = new AbortController();
    c.abort();
    const lane = Lane.throttle(async () => ok(1), 10, { clock: Cap.controlledClock(), signal: c.signal });
    expect(await lane()).toEqual(err({ _tag: "Busy" }));
  });
});

describe("semaphore", () => {
  it("handles the same abort signal supplied at both call and lane level", async () => {
    const controller = new AbortController();
    const sem = Lane.semaphore(1, { signal: controller.signal });
    const gate = deferred<Result<never, number>>();
    let seen: AbortSignal | undefined;
    const result = sem.run((signal) => { seen = signal; return gate.promise; }, controller.signal);
    await tick();
    controller.abort();
    expect(seen?.aborted).toBe(true);
    gate.resolve(ok(1));
    expect(await result).toEqual(ok(1));
    expect(sem.available()).toBe(1);
  });

  it("NaN permits still allow one run", async () => {
    const sem = Lane.semaphore(Number.NaN);
    expect(sem.available()).toBe(1);
    expect(await sem.run(async () => ok(1))).toEqual(ok(1));
    expect(sem.available()).toBe(1);
  });

  it("never exceeds the permits, serves waiters FIFO, and accounts for availability", async () => {
    const sem = Lane.semaphore(2);
    expect(sem.available()).toBe(2);
    let inFlight = 0;
    let peak = 0;
    const order: number[] = [];
    const gates = [deferred<void>(), deferred<void>(), deferred<void>(), deferred<void>()];
    const task = (n: number) =>
      sem.run(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        order.push(n);
        await gates[n]?.promise;
        inFlight--;
        return ok(n);
      });
    const ps = [task(0), task(1), task(2), task(3)];
    await tick();
    expect(order).toEqual([0, 1]);
    expect(sem.available()).toBe(0);
    gates[1]?.resolve();
    await tick();
    expect(order).toEqual([0, 1, 2]);
    gates[0]?.resolve();
    gates[2]?.resolve();
    gates[3]?.resolve();
    expect(await Promise.all(ps)).toEqual([ok(0), ok(1), ok(2), ok(3)]);
    expect(peak).toBe(2);
    expect(sem.available()).toBe(2);
  });

  it("a waiter aborted before acquiring resolves Busy and does not consume a permit; run errors pass through", async () => {
    const sem = Lane.semaphore(1);
    const gate = deferred<Result<never, string>>();
    const holder = sem.run(() => gate.promise);
    const c = new AbortController();
    const waiter: AsyncResult<Lane.Busy | Boom, string> = sem.run(async () => err(boom(1)), c.signal);
    c.abort();
    expect(await waiter).toEqual(err({ _tag: "Busy" }));
    gate.resolve(ok("held"));
    expect(await holder).toEqual(ok("held"));
    expect(sem.available()).toBe(1);
    expect(await sem.run(async () => err(boom(2)))).toEqual(err(boom(2)));
    expect(sem.available()).toBe(1);
  });

  it("an already-aborted signal or lane signal is Busy without running; permits are clamped to >= 1", async () => {
    const c = new AbortController();
    c.abort();
    let runs = 0;
    const sem = Lane.semaphore(0);
    expect(sem.available()).toBe(1);
    expect(await sem.run(async () => (runs++, ok(1)), c.signal)).toEqual(err({ _tag: "Busy" }));
    const laneAborted = Lane.semaphore(3, { signal: c.signal });
    expect(await laneAborted.run(async () => (runs++, ok(1)))).toEqual(err({ _tag: "Busy" }));
    expect(runs).toBe(0);
  });
});
