import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Cap, Lane, err, ok, type Result } from "../src/index.ts";
import { arbEvents, countingSignal, fcParams, observe, pick, tick, tracker, type Event, type Observed, type TrackedRun } from "./helpers/schedule.ts";

type E = { readonly _tag: "Boom"; readonly n: number };
const boom = (n: number): E => ({ _tag: "Boom", n });
const SUPERSEDED = err({ _tag: "Superseded" });
const BUSY = err({ _tag: "Busy" });

/** Settle the i-th unsettled run (mod) with ok/err; returns the run settled, if any. */
const settlePick = <A>(t: ReturnType<typeof tracker<E, A>>, e: Event, value: (run: TrackedRun<E, A>) => A): TrackedRun<E, A> | undefined => {
  if (e.kind !== "ok" && e.kind !== "err") return undefined;
  const run = pick(t.unsettled(), e.i);
  if (run === undefined) return undefined;
  t.settle(run, e.kind === "ok" ? ok(value(run)) : err(boom(run.id)));
  return run;
};

const drain = async <A>(t: ReturnType<typeof tracker<E, A>>, calls: ReadonlyArray<Observed<unknown>>, value: (run: TrackedRun<E, A>) => A): Promise<void> => {
  for (let guard = 0; guard < 60; guard++) {
    await tick();
    t.settleAll((r) => ok(value(r)));
    if (calls.every((c) => c.settled)) return;
  }
  await tick();
};

describe("Lane.switchLane (properties)", () => {
  it("same-turn bursts supersede all earlier calls even when their runs resolve immediately", async () => {
    await fc.assert(fc.asyncProperty(fc.array(fc.integer(), { minLength: 2, maxLength: 10 }), async (items) => {
      const lane = Lane.switchLane(async (_signal, n: number) => ok(n));
      const results = await Promise.all(items.map((n) => lane(n)));
      expect(results).toEqual(items.map((n, i) => i === items.length - 1 ? ok(n) : SUPERSEDED));
    }), fcParams());
  });

  it("a call keeps its own result only if it settled while still the latest; otherwise Superseded at once; ≤1 run awaited; abort settles all, no leaks", async () => {
    await fc.assert(
      fc.asyncProperty(arbEvents(["call", "ok", "err", "abortLane"], 16), async (events) => {
        const lane = countingSignal();
        const t = tracker<E, string>();
        const sw = Lane.switchLane((signal: AbortSignal, n: number) => t.run(signal, n), { signal: lane.signal });
        const calls: Observed<Result<E | Lane.Superseded, string>>[] = [];
        const own = new Map<number, Result<E, string>>(); // calls whose run settled while they were still the latest
        let aborted = false;
        let runsAtAbort = 0;
        for (const e of events) {
          if (e.kind === "call") calls.push(observe(sw(calls.length)));
          else if (e.kind === "abortLane") {
            if (!aborted) runsAtAbort = t.runs.length;
            lane.abort();
            aborted = true;
          } else {
            const run = settlePick(t, e, (r) => `v${r.id}`);
            if (run !== undefined && !aborted && run.args[0] === calls.length - 1 && !run.signal.aborted) {
              own.set(run.args[0] as number, e.kind === "ok" ? ok(`v${run.id}`) : err(boom(run.id)));
            }
          }
          await tick();
          // every call but the newest has settled already — superseded ones without waiting for their run
          for (let i = 0; i < calls.length - 1; i++) expect(calls[i]?.settled).toBe(true);
          expect(t.unsettled().filter((r) => !r.signal.aborted).length).toBeLessThanOrEqual(1); // at most one run awaited
          if (aborted) expect(t.runs.length).toBe(runsAtAbort); // nothing new starts after the abort
        }
        const last = calls.length - 1;
        const lastRun = t.runs.find((r) => r.args[0] === last);
        if (!aborted && lastRun !== undefined && !lastRun.settled) own.set(last, ok(`v${lastRun.id}`)); // drain settles it ok
        await drain(t, calls, (r) => `v${r.id}`);
        expect(calls.every((c) => c.settled)).toBe(true);
        expect(lane.listeners()).toBe(0);
        if (aborted) expect(t.runs.length).toBe(runsAtAbort);
        for (let i = 0; i < calls.length; i++) {
          const expected = own.get(i);
          expect(calls[i]?.value).toEqual(expected ?? SUPERSEDED);
        }
        // only a call that was still the latest when its run finished can be ok
        for (let i = 0; i < calls.length; i++) if ((calls[i]?.value as Result<unknown, unknown>).ok) expect(own.has(i)).toBe(true);
      }),
      fcParams(),
    );
  });
});

describe("Lane.exhaustLane (properties)", () => {
  it("≤1 run in flight; calls while busy are Busy and start nothing; after a lane abort nothing new starts", async () => {
    await fc.assert(
      fc.asyncProperty(arbEvents(["call", "ok", "err", "abortLane"], 16), async (events) => {
        const lane = countingSignal();
        const t = tracker<E, number>();
        const ex = Lane.exhaustLane((signal: AbortSignal, n: number) => t.run(signal, n), { signal: lane.signal });
        const calls: Observed<Result<E | Lane.Busy, number>>[] = [];
        let aborted = false;
        for (const e of events) {
          if (e.kind === "call") {
            const busyBefore = t.inFlight() > 0 || aborted;
            const started = t.runs.length;
            const c = observe(ex(calls.length));
            calls.push(c);
            await tick();
            if (busyBefore) {
              expect(c.settled).toBe(true);
              expect(c.value).toEqual(BUSY);
              expect(t.runs.length).toBe(started);
            } else expect(t.runs.length).toBe(started + 1);
          } else if (e.kind === "abortLane") {
            lane.abort();
            aborted = true;
          } else settlePick(t, e, (r) => r.id);
          await tick();
          expect(t.inFlight()).toBeLessThanOrEqual(1);
        }
        await drain(t, calls, (r) => r.id);
        expect(calls.every((c) => c.settled)).toBe(true);
        expect(lane.listeners()).toBe(0);
        // a started run's own result comes back to its caller
        for (const r of t.runs) {
          const c = calls[r.args[0] as number] as Observed<Result<E | Lane.Busy, number>>;
          expect(c.value).toEqual(r.settled ? (c.value as Result<unknown, unknown>).ok ? ok(r.id) : err(boom(r.id)) : c.value);
        }
      }),
      fcParams(),
    );
  });
});

describe("Lane.queueLane (properties)", () => {
  const harness = async (depth: number, events: Event[], strictPromptBusy: boolean): Promise<void> => {
    const lane = countingSignal();
    const t = tracker<E, number>();
    const q = Lane.queueLane((signal: AbortSignal, n: number) => t.run(signal, n), { depth, signal: lane.signal });
    const calls: Observed<Result<E | Lane.QueueFull | Lane.Busy, number>>[] = [];
    const accepted: number[] = [];
    let aborted = false;
    for (const e of events) {
      if (e.kind === "call") {
        const n = calls.length;
        const startedSet = new Set(t.runs.map((r) => r.args[0] as number));
        const waiting = accepted.filter((a) => !startedSet.has(a)).length;
        const c = observe(q(n));
        calls.push(c);
        await tick();
        if (aborted) expect(c.value).toEqual(BUSY);
        else if (c.settled && (c.value as Result<unknown, unknown>).ok === false && (c.value as { error: { _tag: string } }).error._tag === "QueueFull") {
          expect(waiting).toBeGreaterThanOrEqual(depth); // only rejected when the queue really is full
        } else accepted.push(n);
      } else if (e.kind === "abortLane") {
        lane.abort();
        aborted = true;
      } else settlePick(t, e, (r) => r.id);
      await tick();
      expect(t.inFlight()).toBeLessThanOrEqual(1);
      const started = t.runs.map((r) => r.args[0] as number);
      expect(started).toEqual([...started].sort((a, b) => a - b)); // strictly in call order
      const waitingNow = accepted.filter((a) => !started.includes(a)).length;
      if (!aborted) expect(waitingNow).toBeLessThanOrEqual(depth); // never more than depth waiting behind the running one
      if (aborted && (strictPromptBusy || t.inFlight() === 0)) {
        for (const a of accepted) if (!started.includes(a)) expect(calls[a]?.value).toEqual(BUSY);
      }
    }
    const runsAtEnd = t.runs.length;
    await drain(t, calls, (r) => r.id);
    expect(calls.every((c) => c.settled)).toBe(true);
    expect(lane.listeners()).toBe(0);
    if (aborted) {
      expect(t.runs.length).toBe(runsAtEnd); // waiters never start after an abort
      for (const a of accepted) if (!t.runs.some((r) => r.args[0] === a)) expect(calls[a]?.value).toEqual(BUSY);
    } else expect(t.runs.map((r) => r.args[0])).toEqual(accepted); // every accepted call ran, in order, failures included
  };

  it("one at a time, in call order, ≤depth waiting, QueueFull beyond, failures do not block, abort → waiters Busy (once the in-flight run returns) and never start", async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 0, max: 3 }), arbEvents(["call", "ok", "err", "abortLane"], 18), (depth, events) => harness(depth, events, false)), fcParams());
  });

  // BUG: after a lane-level abort, a waiting call only resolves Busy once the in-flight run returns, because the
  // waiter is chained on the previous run's promise (`tail.then(...)`). Minimized: depth 1, [call, call, abortLane]
  // → the second call is still pending after the abort while run #1 is unsettled. Seed: -1045923396 (path 3:3:8).
  // Expected per the docs ("resolve Busy promptly"): the waiter settles without waiting for the running call.
  it("strict: waiters resolve Busy promptly after a lane abort, even while a run is in flight", async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 0, max: 3 }), arbEvents(["call", "ok", "err", "abortLane"], 18), (depth, events) => harness(depth, events, true)), fcParams());
  });
});

describe("Lane.debounce (properties)", () => {
  it("a run starts only when a sleep fires with no newer call; earlier calls in a burst are Superseded; no leaked timers", async () => {
    await fc.assert(
      fc.asyncProperty(arbEvents(["call", "fire", "ok", "err", "abortLane"], 18), async (events) => {
        const sleeper = Cap.manualSleeper();
        const lane = countingSignal();
        const t = tracker<E, number>();
        const db = Lane.debounce((signal: AbortSignal, n: number) => t.run(signal, n), 50, { sleeper, signal: lane.signal });
        const calls: Observed<Result<E | Lane.Superseded, number>>[] = [];
        let aborted = false;
        for (const e of events) {
          const started = t.runs.length;
          if (e.kind === "call") calls.push(observe(db(calls.length)));
          else if (e.kind === "fire") {
            const latest = calls.length - 1;
            sleeper.fire(0);
            await tick();
            if (sleeper.pending().length === 0 && latest >= 0 && !aborted && t.runs.length === started + 1) {
              expect(t.runs[t.runs.length - 1]?.args[0]).toBe(latest); // the run belongs to the newest call
            }
          } else if (e.kind === "abortLane") {
            lane.abort();
            aborted = true;
          } else settlePick(t, e, (r) => r.id);
          await tick();
          expect(sleeper.pending().length).toBeLessThanOrEqual(1); // at most one quiet period pending
          if (e.kind === "call") expect(t.runs.length).toBe(started); // a call never starts a run by itself
          // every call but the newest is already Superseded unless it already got its own run
          for (let i = 0; i < calls.length - 1; i++) {
            const c = calls[i] as Observed<unknown>;
            const hadRun = t.runs.some((r) => r.args[0] === i);
            if (!hadRun) expect(c.value).toEqual(SUPERSEDED);
          }
        }
        sleeper.fireAll();
        await drain(t, calls, (r) => r.id);
        expect(sleeper.pending()).toEqual([]);
        expect(calls.every((c) => c.settled)).toBe(true);
        expect(lane.listeners()).toBe(0);
      }),
      fcParams(),
    );
  });
});

describe("Lane.throttle (properties)", () => {
  it("at most one start per window; calls inside the window are Busy and never start", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 10 }), arbEvents(["call", "advance", "ok", "err"], 20), async (windowMs, events) => {
        const clock = Cap.controlledClock(1000);
        const t = tracker<E, number>();
        const th = Lane.throttle((signal: AbortSignal, n: number) => t.run(signal, n), windowMs, { clock });
        const starts: number[] = [];
        const calls: Observed<Result<E | Lane.Busy, number>>[] = [];
        for (const e of events) {
          if (e.kind === "call") {
            const before = t.runs.length;
            const c = observe(th(calls.length));
            calls.push(c);
            await tick();
            const last = starts[starts.length - 1];
            const inside = last !== undefined && clock.now() - last < windowMs;
            if (inside) {
              expect(c.value).toEqual(BUSY);
              expect(t.runs.length).toBe(before);
            } else {
              expect(t.runs.length).toBe(before + 1);
              starts.push(clock.now());
            }
          } else if (e.kind === "advance") clock.advance(e.ms);
          else settlePick(t, e, (r) => r.id);
          await tick();
        }
        for (let i = 1; i < starts.length; i++) expect((starts[i] as number) - (starts[i - 1] as number)).toBeGreaterThanOrEqual(windowMs);
        await drain(t, calls, (r) => r.id);
        expect(calls.every((c) => c.settled)).toBe(true);
      }),
      fcParams(),
    );
  });
});

describe("Lane.semaphore (properties)", () => {
  it("abort between permit acquisition and callback start returns Busy and restores the permit", async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (permits) => {
      const sem = Lane.semaphore(permits);
      const signal = countingSignal();
      let started = false;
      const result = sem.run(async () => { started = true; return ok(1); }, signal.signal);
      signal.abort();
      expect(await result).toEqual(BUSY);
      expect(started).toBe(false);
      expect(sem.available()).toBe(permits);
      expect(signal.listeners()).toBe(0);
    }), fcParams());
  });

  it("permits never exceeded; FIFO; every permit released; aborted waiters are Busy without a permit; no listener leaks", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 3 }), arbEvents(["call", "ok", "err", "abortCall", "abortLane"], 18), async (permits, events) => {
        const lane = countingSignal();
        const t = tracker<E, number>();
        const sem = Lane.semaphore(permits, { signal: lane.signal });
        const callSignals: ReturnType<typeof countingSignal>[] = [];
        const calls: Observed<Result<E | Lane.Busy, number>>[] = [];
        let laneAborted = false;
        for (const e of events) {
          if (e.kind === "call") {
            const cs = countingSignal();
            callSignals.push(cs);
            const n = calls.length;
            calls.push(observe(sem.run((signal) => t.run(signal, n), cs.signal)));
          } else if (e.kind === "abortCall") {
            const cs = pick(callSignals.filter((s) => !s.signal.aborted), e.i);
            cs?.abort();
          } else if (e.kind === "abortLane") {
            lane.abort();
            laneAborted = true;
          } else settlePick(t, e, (r) => r.id);
          await tick();
          expect(t.inFlight()).toBeLessThanOrEqual(permits);
          expect(sem.available()).toBe(permits - t.inFlight());
          const started = t.runs.map((r) => r.args[0] as number);
          expect(started).toEqual([...started].sort((a, b) => a - b)); // FIFO among the calls that started
          // a waiter whose signal aborted resolved Busy and did not start
          for (let i = 0; i < calls.length; i++) {
            const cs = callSignals[i] as ReturnType<typeof countingSignal>;
            if ((cs.signal.aborted || laneAborted) && !started.includes(i)) {
              expect(calls[i]?.value).toEqual(BUSY);
            }
          }
        }
        await drain(t, calls, (r) => r.id);
        expect(calls.every((c) => c.settled)).toBe(true);
        expect(sem.available()).toBe(permits); // every acquired permit released, failures included
        expect(lane.listeners()).toBe(0);
        for (const cs of callSignals) expect(cs.listeners()).toBe(0);
      }),
      fcParams(),
    );
  });
});
