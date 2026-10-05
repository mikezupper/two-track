import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Async, Cap, err, ok, type Result } from "../src/index.ts";
import { arbEvents, countingSignal, deferred, fcParams, observe, pick, tick, tracker } from "./helpers/schedule.ts";

type E = { readonly _tag: "T"; readonly n: number };
const te = (n: number): E => ({ _tag: "T", n });

/** Where the abort happens relative to the retry schedule. */
type AbortAt = { readonly at: "never" } | { readonly at: "before" } | { readonly at: "run"; readonly k: number } | { readonly at: "sleep"; readonly k: number };
const arbAbortAt = (attempts: number): fc.Arbitrary<AbortAt> =>
  fc.oneof(
    fc.constant<AbortAt>({ at: "never" }),
    fc.constant<AbortAt>({ at: "before" }),
    fc.integer({ min: 1, max: attempts }).map<AbortAt>((k) => ({ at: "run", k })),
    fc.integer({ min: 1, max: Math.max(1, attempts - 1) }).map<AbortAt>((k) => ({ at: "sleep", k })),
  );

describe("Async.retry (properties)", () => {
  it("abort anywhere in the schedule: never more runs than started before the abort; Aborted outside a run; no leaked sleeps", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 6 }).chain((attempts) => fc.tuple(fc.constant(attempts), arbAbortAt(attempts))),
        async ([attempts, abortAt]) => {
          const manual = Cap.manualSleeper();
          const requested: number[] = [];
          const sleeper: Cap.Sleeper = { sleep: (ms, s) => (requested.push(ms), manual.sleep(ms, s)) };
          const c = new AbortController();
          const t = tracker<E, number>();
          const delay = (n: number): number => n * 10;
          if (abortAt.at === "before") c.abort();
          const p = observe(Async.retry((_, signal) => t.run(signal), { attempts, delay, retriable: () => true, sleeper, signal: c.signal }));
          let sleeps = 0;
          for (let guard = 0; guard < 40 && !p.settled; guard++) {
            await tick();
            const run = t.unsettled()[0];
            if (run !== undefined) {
              if (abortAt.at === "run" && abortAt.k === run.id + 1) c.abort();
              t.settle(run, err(te(run.id)));
              continue;
            }
            if (manual.pending().length > 0) {
              sleeps++;
              if (abortAt.at === "sleep" && abortAt.k === sleeps) c.abort();
              else manual.fire();
            }
          }
          await tick();
          expect(p.settled).toBe(true);
          expect(t.runs.length).toBeLessThanOrEqual(attempts);
          expect(manual.pending()).toEqual([]);
          expect(requested).toEqual(Array.from({ length: requested.length }, (_, i) => delay(i + 1)));
          if (abortAt.at === "before") {
            expect(t.runs.length).toBe(0);
            expect(p.value).toEqual(err({ _tag: "Aborted" }));
          } else if (abortAt.at === "sleep" && abortAt.k < attempts) {
            expect(t.runs.length).toBe(abortAt.k); // exactly k runs, none after the abort
            expect(p.value).toEqual(err({ _tag: "Aborted" }));
          } else if (abortAt.at === "run") {
            expect(t.runs.length).toBe(abortAt.k); // the aborted run's own result, no further runs
            expect(p.value).toEqual(err(te(abortAt.k - 1)));
          } else {
            expect(t.runs.length).toBe(attempts);
            expect(p.value).toEqual(err(te(attempts - 1)));
          }
          for (const r of t.runs) expect(r.signal).toBe(c.signal);
        },
      ),
      fcParams(),
    );
  });

  it("stops at the first ok or the first non-retriable error, never exceeding attempts, with delays policy.delay(1..n-1)", async () => {
    type Outcome = "ok" | "retriable" | "fatal";
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 8 }), fc.array(fc.constantFrom<Outcome>("ok", "retriable", "fatal"), { minLength: 8, maxLength: 8 }), async (attempts, outcomes) => {
        const sleeper = Cap.instantSleeper();
        let calls = 0;
        const result = await Async.retry(
          async (attempt): Promise<Result<E, string>> => {
            calls++;
            expect(attempt).toBe(calls);
            const o = outcomes[attempt - 1] as Outcome;
            return o === "ok" ? ok(`ok@${attempt}`) : err(te(o === "retriable" ? 1 : 0));
          },
          { attempts, delay: (n) => n * 7, retriable: (e) => e.n === 1, sleeper },
        );
        const firstOk = outcomes.findIndex((o) => o === "ok");
        const firstFatal = outcomes.findIndex((o) => o === "fatal");
        const stopAt = [firstOk, firstFatal].filter((i) => i >= 0).reduce((a, b) => Math.min(a, b), attempts - 1);
        const expectedCalls = Math.min(attempts, stopAt + 1);
        expect(calls).toBe(expectedCalls);
        expect(calls).toBeLessThanOrEqual(attempts);
        const last = outcomes[expectedCalls - 1] as Outcome;
        expect(result).toEqual(last === "ok" ? ok(`ok@${expectedCalls}`) : err(te(last === "retriable" ? 1 : 0)));
        expect(sleeper.calls).toEqual(Array.from({ length: expectedCalls - 1 }, (_, i) => (i + 1) * 7));
      }),
      fcParams(),
    );
  });

  it("backoff: monotone non-decreasing, capped, and jitter stays within [0, cap]", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.double({ min: 1, max: 4, noNaN: true }),
        fc.option(fc.integer({ min: 1, max: 100_000 }), { nil: undefined }),
        fc.integer(),
        (baseMs, factor, maxMs, seed) => {
          const cap = maxMs === undefined ? Number.POSITIVE_INFINITY : maxMs;
          const plain = Async.backoff(maxMs === undefined ? { baseMs, factor } : { baseMs, factor, maxMs });
          const random = Cap.seededRandom(seed);
          const jittered = Async.backoff(maxMs === undefined ? { baseMs, factor, random: random.next } : { baseMs, factor, maxMs, random: random.next });
          let previous = 0;
          for (let n = 1; n <= 10; n++) {
            const d = plain(n);
            expect(d).toBeGreaterThanOrEqual(previous);
            expect(d).toBeLessThanOrEqual(cap);
            expect(d).toBe(Math.min(cap, baseMs * factor ** (n - 1)));
            const j = jittered(n);
            expect(j).toBeGreaterThanOrEqual(0);
            expect(j).toBeLessThanOrEqual(d);
            previous = d;
          }
        },
      ),
      fcParams({ numRuns: 200 }),
    );
  });
});

describe("Async.mapConcurrent (properties)", () => {
  it("bound respected; order preserved; first error aborts in-flight runs and stops new ones; outer listener removed", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 1, max: 5 }),
        fc.array(fc.boolean(), { minLength: 10, maxLength: 10 }),
        arbEvents(["ok", "err", "abortLane"], 24),
        async (n, concurrency, failing, events) => {
          const items = Array.from({ length: n }, (_, i) => i);
          const outer = countingSignal();
          const t = tracker<E, number>();
          let peak = 0;
          const p = observe(Async.mapConcurrent(items, (item, _i, signal) => t.run(signal, item), { concurrency, signal: outer.signal }));
          let firstErrorAt: number | undefined; // number of runs started when the first error settled
          let abortedAt: number | undefined;
          let firstError: Result<E, never> | undefined;
          for (const e of events) {
            await tick();
            peak = Math.max(peak, t.inFlight());
            expect(t.inFlight()).toBeLessThanOrEqual(concurrency);
            if (e.kind === "abortLane") {
              if (!outer.signal.aborted) {
                outer.abort();
                abortedAt ??= t.runs.length;
              }
              continue;
            }
            if (e.kind !== "ok" && e.kind !== "err") continue;
            const run = pick(t.unsettled(), e.i);
            if (run === undefined) continue;
            const item = run.args[0] as number;
            const fails = e.kind === "err" || failing[item] === true;
            if (fails) {
              const r = err(te(item));
              firstError ??= r;
              firstErrorAt ??= t.runs.length;
              t.settle(run, r);
            } else t.settle(run, ok(item * 10));
          }
          // drain: settle whatever is still running so the combinator can finish
          await tick();
          const stoppedAt = firstErrorAt ?? abortedAt;
          if (stoppedAt !== undefined) expect(t.runs.length).toBe(stoppedAt); // no new run after the stop
          while (!p.settled) {
            const run = t.unsettled()[0];
            if (run === undefined) break;
            t.settle(run, ok((run.args[0] as number) * 10));
            await tick();
          }
          await tick();
          expect(p.settled).toBe(true);
          expect(peak).toBeLessThanOrEqual(concurrency);
          expect(outer.listeners()).toBe(0);
          if (firstError !== undefined) {
            expect(p.value).toEqual(firstError);
            for (const r of t.runs) expect(r.signal.aborted).toBe(true); // every in-flight run was signalled
          } else if (abortedAt === undefined) {
            expect(p.value).toEqual(ok(items.map((i) => i * 10)));
            expect(t.runs.map((r) => r.args[0])).toEqual(items);
          }
        },
      ),
      fcParams(),
    );
  });
});

describe("Async.validateConcurrent (properties)", () => {
  it("runs every item regardless of errors, bound respected, errors in input order", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.boolean(), { maxLength: 12 }), fc.integer({ min: 1, max: 4 }), fc.array(fc.nat({ max: 7 }), { maxLength: 40 }), async (failing, concurrency, order) => {
        const items = failing.map((_, i) => i);
        const t = tracker<E, number>();
        let peak = 0;
        const p = observe(Async.validateConcurrent(items, (item, _i, signal) => t.run(signal, item), { concurrency }));
        for (const i of order) {
          await tick();
          peak = Math.max(peak, t.inFlight());
          const run = pick(t.unsettled(), i);
          if (run === undefined) continue;
          const item = run.args[0] as number;
          t.settle(run, failing[item] === true ? err(te(item)) : ok(item));
        }
        while (!p.settled) {
          await tick();
          const run = t.unsettled()[0];
          if (run !== undefined) {
            const item = run.args[0] as number;
            t.settle(run, failing[item] === true ? err(te(item)) : ok(item));
          }
        }
        expect(t.runs.length).toBe(items.length);
        expect(peak).toBeLessThanOrEqual(concurrency);
        const errors = items.filter((i) => failing[i] === true).map(te);
        expect(p.value).toEqual(errors.length === 0 ? ok(items) : err(errors));
      }),
      fcParams(),
    );
  });
});

describe("Async.withTimeout (few, real-timer, order-insensitive)", () => {
  it("inner never settles → timeout error, inner signal aborted, parent listener removed; inner settles → its result", async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), fc.boolean(), async (innerSettles, innerOk) => {
        const parent = countingSignal();
        const inner = deferred<Result<E, string>>();
        let seen: AbortSignal | undefined;
        let resolutions = 0;
        const p = Async.withTimeout(
          (signal) => {
            seen = signal;
            if (innerSettles) inner.resolve(innerOk ? ok("v") : err(te(1)));
            return inner.promise;
          },
          5,
          () => ({ _tag: "Timeout" as const }),
          parent.signal,
        ).then((r) => (resolutions++, r));
        const r = await p;
        expect(resolutions).toBe(1);
        expect(parent.listeners()).toBe(0);
        if (innerSettles) expect(r).toEqual(innerOk ? ok("v") : err(te(1)));
        else {
          expect(r).toEqual(err({ _tag: "Timeout" }));
          expect(seen?.aborted).toBe(true);
        }
      }),
      fcParams({ numRuns: 8 }),
    );
  });

  it("parent abort propagates to the inner signal and does not produce a timeout error", async () => {
    const parent = countingSignal();
    const p = Async.withTimeout(
      (signal) => new Promise<Result<string, never>>((resolve) => signal.addEventListener("abort", () => resolve(err("cancelled")), { once: true })),
      10_000,
      () => "timeout",
      parent.signal,
    );
    parent.abort();
    expect(await p).toEqual(err("cancelled"));
    expect(parent.listeners()).toBe(0);
  });
});

// ---------- the plain promise combinators: the async railway agrees with the sync one ----------

const arbR = (): fc.Arbitrary<Result<string, number>> => fc.oneof(fc.integer().map((n) => ok(n)), fc.string().map((s) => err(s)));
const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const lift = <T>(r: T): Promise<T> => Promise.resolve(r);

describe("Async combinators agree with R (properties)", () => {
  it("map / mapErr / andThen / orElse / match / tap / tapErr: Async.f(lift(r)) == R.f(r) for every r", async () => {
    const { R } = await import("../src/index.ts");
    await fc.assert(
      fc.asyncProperty(arbR(), fc.func(fc.integer()), fc.func(fc.string()), fc.func(arbR()), async (r, f, g, k) => {
        expect(eq(await Async.map(lift(r), f), R.map(r, f))).toBe(true);
        expect(eq(await Async.mapErr(lift(r), g), R.mapErr(r, g))).toBe(true);
        expect(eq(await Async.andThen(lift(r), (a) => lift(k(a))), R.andThen(r, k))).toBe(true);
        expect(eq(await Async.andThen(r, k), R.andThen(r, k))).toBe(true); // sync input and sync continuation are accepted too
        expect(eq(await Async.orElse(lift(r), (e) => lift(k(e.length))), R.orElse(r, (e) => k(e.length)))).toBe(true);
        expect(await Async.match(lift(r), f, (e) => g(e).length)).toBe(R.match(r, f, (e) => g(e).length));
        const seen: unknown[] = [];
        expect(eq(await Async.tap(lift(r), (a) => { seen.push(a); }), r)).toBe(true);
        expect(eq(await Async.tapErr(lift(r), (e) => { seen.push(e); }), r)).toBe(true);
        expect(seen).toEqual([r.ok ? r.value : r.error]); // exactly one side effect, on the track that was taken
      }),
      fcParams(),
    );
  });

  it("all(promises) == R.all(results) — first error wins, order preserved, regardless of settlement order", async () => {
    const { R } = await import("../src/index.ts");
    await fc.assert(
      fc.asyncProperty(fc.array(arbR(), { maxLength: 8 }), fc.array(fc.nat({ max: 3 })), async (rs, delays) => {
        const promises = rs.map((r, i) => new Promise<Result<string, number>>((resolve) => setTimeout(() => resolve(r), delays[i] ?? 0)));
        expect(eq(await Async.all(promises), R.all(rs))).toBe(true);
      }),
      fcParams(),
    );
  });

  it("fromPromise / tryPromise never reject, for any thrown or rejected value, sync or async", async () => {
    await fc.assert(
      fc.asyncProperty(fc.anything(), fc.boolean(), fc.boolean(), async (thrown, rejects, syncThrow) => {
        const onReject = (cause: unknown): E => te(typeof cause === "number" ? cause : 0);
        const p = rejects ? Promise.reject(thrown) : Promise.resolve(thrown);
        const viaFrom = await Async.fromPromise(p, onReject);
        expect(viaFrom.ok).toBe(!rejects);
        const thunk = (): Promise<unknown> => {
          if (syncThrow) throw thrown; // interop edge: a synchronously throwing thunk is still converted
          return rejects ? Promise.reject(thrown) : Promise.resolve(thrown);
        };
        const viaTry = await Async.tryPromise(thunk, onReject);
        expect(viaTry.ok).toBe(!rejects && !syncThrow);
        if (!viaTry.ok) expect(viaTry.error._tag).toBe("T");
      }),
      fcParams(),
    );
  });
});
