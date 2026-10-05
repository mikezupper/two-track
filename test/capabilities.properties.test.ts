import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Cap } from "../src/index.ts";
import { countingSignal, fcParams, observe, tick } from "./helpers/schedule.ts";

describe("Cap.seededRandom (properties)", () => {
  it("is deterministic per seed, in [0, 1), and spread out", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const a = Cap.seededRandom(seed);
        const b = Cap.seededRandom(seed);
        const xs = Array.from({ length: 1000 }, () => a.next());
        expect(xs).toEqual(Array.from({ length: 1000 }, () => b.next()));
        expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
        expect(new Set(xs).size).toBeGreaterThanOrEqual(900);
      }),
      fcParams({ numRuns: 50 }),
    );
  });
});

describe("Cap.controlledClock (properties)", () => {
  it("is monotone under advance and exact under set", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e12 }), fc.array(fc.integer({ min: 0, max: 1e6 }), { maxLength: 30 }), fc.integer({ min: 0, max: 1e12 }), (start, steps, target) => {
        const clock = Cap.controlledClock(start);
        let previous = clock.now();
        expect(previous).toBe(start);
        for (const ms of steps) {
          clock.advance(ms);
          expect(clock.now()).toBe(previous + ms);
          expect(clock.now()).toBeGreaterThanOrEqual(previous);
          previous = clock.now();
        }
        clock.set(target);
        expect(clock.now()).toBe(target);
      }),
      fcParams({ numRuns: 100 }),
    );
  });
});

describe("Cap.manualSleeper (properties)", () => {
  it("pending reflects sleeps in call order; fire(i) resolves exactly that sleep; abort removes and resolves; fireAll drains", async () => {
    type Op = { readonly kind: "sleep"; readonly ms: number } | { readonly kind: "fire"; readonly i: number } | { readonly kind: "abort"; readonly i: number } | { readonly kind: "fireAll" };
    const arbOp: fc.Arbitrary<Op> = fc.oneof(
      fc.integer({ min: 0, max: 500 }).map<Op>((ms) => ({ kind: "sleep", ms })),
      fc.nat({ max: 6 }).map<Op>((i) => ({ kind: "fire", i })),
      fc.nat({ max: 6 }).map<Op>((i) => ({ kind: "abort", i })),
      fc.constant<Op>({ kind: "fireAll" }),
    );
    await fc.assert(
      fc.asyncProperty(fc.array(arbOp, { maxLength: 25 }), async (ops) => {
        const sleeper = Cap.manualSleeper();
        type Live = { readonly ms: number; readonly o: ReturnType<typeof observe<void>>; readonly cs: ReturnType<typeof countingSignal> };
        const model: Live[] = []; // pending sleeps in call order, mirrored from the model's view
        const all: Live[] = [];
        for (const op of ops) {
          if (op.kind === "sleep") {
            const cs = countingSignal();
            const live: Live = { ms: op.ms, o: observe(sleeper.sleep(op.ms, cs.signal)), cs };
            model.push(live);
            all.push(live);
          } else if (op.kind === "fire") {
            const index = op.i < model.length ? op.i : model.length; // out of range is a no-op
            sleeper.fire(op.i);
            if (index < model.length) model.splice(index, 1);
          } else if (op.kind === "abort") {
            const target = model[op.i % Math.max(1, model.length)];
            if (target !== undefined) {
              target.cs.abort();
              model.splice(model.indexOf(target), 1);
            }
          } else {
            sleeper.fireAll();
            model.length = 0;
          }
          await tick();
          expect(sleeper.pending()).toEqual(model.map((l) => l.ms));
          for (const l of all) {
            const stillPending = model.includes(l);
            expect(l.o.settled).toBe(!stillPending);
            if (!stillPending) expect(l.cs.listeners()).toBe(0); // fired or aborted sleeps leave no listener behind
          }
        }
        sleeper.fireAll();
        await tick();
        expect(sleeper.pending()).toEqual([]);
        for (const l of all) {
          expect(l.o.settled).toBe(true);
          expect(l.cs.listeners()).toBe(0);
        }
      }),
      fcParams(),
    );
  });

  it("a sleep on an already-aborted signal resolves immediately and is never pending", async () => {
    const sleeper = Cap.manualSleeper();
    const cs = countingSignal();
    cs.abort();
    const o = observe(sleeper.sleep(100, cs.signal));
    await tick();
    expect(o.settled).toBe(true);
    expect(sleeper.pending()).toEqual([]);
  });
});

describe("Cap.instantSleeper (properties)", () => {
  it("records every requested delay in order and never waits", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.integer({ min: 0, max: 10_000 }), { maxLength: 20 }), async (delays) => {
        const sleeper = Cap.instantSleeper();
        for (const ms of delays) await sleeper.sleep(ms);
        expect(sleeper.calls).toEqual(delays);
      }),
      fcParams({ numRuns: 50 }),
    );
  });
});

// systemClock / systemSleeper / systemRandom / systemIdGen wrap the platform (Date.now, setTimeout, Math.random,
// crypto.randomUUID). Their behaviour is the platform's; the example tests check the wiring, and the seeded /
// manual / controlled implementations above are where the properties live. Listed here so the
// property-test-coverage invariant records the decision rather than being silenced.
describe("Cap.system* adapters", () => {
  it("expose the platform without reinterpretation", () => {
    expect(typeof Cap.systemClock.now()).toBe("number");
    expect(typeof Cap.systemSleeper.sleep).toBe("function");
    expect(Cap.systemRandom.next()).toBeLessThan(1);
    expect(Cap.systemIdGen.next()).toHaveLength(36);
  });
});

describe("Cap.sequentialIds (properties)", () => {
  it("ids are unique, strictly increasing, and carry the prefix, for any prefix and count", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 8 }), fc.integer({ min: 1, max: 200 }), (prefix, n) => {
        const gen = Cap.sequentialIds(prefix);
        const ids = Array.from({ length: n }, () => gen.next());
        expect(new Set(ids).size).toBe(n);
        expect(ids.every((id, i) => id === `${prefix}${i + 1}`)).toBe(true);
      }),
      fcParams(),
    );
  });
});
