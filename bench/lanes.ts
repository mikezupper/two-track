/**
 * Lane throughput: the per-trigger cost of each Lane relative to calling the
 * run function directly. Generated schedules (test/lanes.properties.test.ts)
 * prove the coordination semantics; this measures what they cost at high
 * trigger rates. Two workloads:
 *   immediate — the run resolves at once: pure coordination overhead.
 *   waiting   — every run awaits a deferred settled after the whole burst:
 *               pending-state bookkeeping (queues, listeners, races).
 * Best of five, fixed checksums, no real timers (instantSleeper / controlledClock).
 *
 *   node bench/lanes.ts                 report
 *   node bench/lanes.ts --check         enforce ratio gates vs the same-run baseline
 *   node --expose-gc bench/lanes.ts     also report heap retained per pending trigger
 *
 * Ratios, not milliseconds, are the invariant: they are stable across machines.
 */
import { Cap, Lane, ok, type AsyncResult, type Result } from "../src/index.ts";

type Outcome = Result<unknown, number>;
type Run = (signal: AbortSignal, n: number) => AsyncResult<never, number>;
type Deferred = { readonly promise: Promise<Result<never, number>>; readonly resolve: (r: Result<never, number>) => void };

const N_IMMEDIATE = Number(process.env["LANES_N"] ?? 200_000);
const N_WAITING = Number(process.env["LANES_N_WAIT"] ?? 20_000);
const REPEATS = 5;
// Gates: observed ratios on the reference machine (Node 24) — immediate: switch 36x,
// debounce 28x, throttle 3.7x, queue 3.2x, exhaust 0.6x; waiting: switch 50x,
// debounce 39x, semaphore 14x, throttle 3x, queue 2.4x. Limits sit at roughly 2x the
// observed worst case, rounded up. (semaphore immediate measured 376x before its waiter queue was changed from
// Array.shift()/indexOf to a head-index FIFO with tombstones; 7x after — see decision 0009.)
const LIMIT_IMMEDIATE = 75;
const LIMIT_WAITING = 100;
const check = process.argv.includes("--check");
const gc: (() => void) | undefined = (globalThis as { gc?: () => void }).gc;

const deferred = (): Deferred => {
  let resolve!: (r: Result<never, number>) => void;
  const promise = new Promise<Result<never, number>>((res) => { resolve = res; });
  return { promise, resolve };
};

const settledOk = (results: ReadonlyArray<Outcome>): number => {
  let n = 0;
  for (let i = 0; i < results.length; i++) if ((results[i] as Outcome).ok) n++;
  return n;
};

type Row = { readonly name: string; readonly ms: number; readonly okCount: number; readonly expectedOk: number; readonly heapPerPending?: number };

/** A lane under test: builds a fresh lane around `run`, fires N triggers, and checks its own leak condition. */
type Subject = {
  readonly name: string;
  readonly expectedOk: (n: number) => number;
  readonly make: (run: Run) => { readonly fire: (n: number) => AsyncResult<unknown, number>; readonly afterwards: () => void };
};

const subjects: ReadonlyArray<Subject> = [
  { name: "baseline (direct call)", expectedOk: (n) => n, make: (run) => ({ fire: (n) => run(new AbortController().signal, n), afterwards: () => undefined }) },
  { name: "switchLane", expectedOk: () => 1, make: (run) => ({ fire: Lane.switchLane(run), afterwards: () => undefined }) },
  { name: "exhaustLane", expectedOk: () => 1, make: (run) => ({ fire: Lane.exhaustLane(run), afterwards: () => undefined }) },
  { name: "queueLane (depth ∞)", expectedOk: (n) => n, make: (run) => ({ fire: Lane.queueLane(run), afterwards: () => undefined }) },
  {
    name: "debounce (1 ms, instantSleeper)",
    expectedOk: () => 1, // coalesces: only the last call of the burst runs
    make: (run) => {
      const sleeper = Cap.instantSleeper();
      return { fire: Lane.debounce(run, 1, { sleeper }), afterwards: () => { if (sleeper.calls.length < 1) throw new Error("debounce: sleeper never consulted"); } };
    },
  },
  {
    name: "throttle (0 ms, controlledClock)",
    expectedOk: (n) => n,
    make: (run) => {
      const clock = Cap.controlledClock();
      const lane = Lane.throttle(run, 0, { clock });
      return { fire: (n) => { clock.advance(1); return lane(n); }, afterwards: () => undefined };
    },
  },
  {
    name: "semaphore(16).run",
    expectedOk: (n) => n,
    make: (run) => {
      const sem = Lane.semaphore(16);
      return { fire: (n) => sem.run((signal) => run(signal, n)), afterwards: () => { if (sem.available() !== 16) throw new Error(`semaphore: ${sem.available()} permits available, expected 16 — leaked`); } };
    },
  },
];

const burst = async (subject: Subject, run: Run, n: number, settle?: () => void): Promise<{ readonly ms: number; readonly okCount: number; readonly heapPerPending?: number }> => {
  const lane = subject.make(run);
  const results = new Array<AsyncResult<unknown, number>>(n);
  const before = gc !== undefined ? (gc(), process.memoryUsage().heapUsed) : undefined;
  const start = performance.now();
  for (let i = 0; i < n; i++) results[i] = lane.fire(i);
  const pendingHeap = before !== undefined ? process.memoryUsage().heapUsed - before : undefined;
  settle?.();
  const settled = await Promise.all(results);
  const ms = performance.now() - start;
  lane.afterwards();
  return { ms, okCount: settledOk(settled), ...(pendingHeap !== undefined ? { heapPerPending: pendingHeap / n } : {}) };
};

const measure = async (subject: Subject, workload: "immediate" | "waiting"): Promise<Row> => {
  const n = workload === "immediate" ? N_IMMEDIATE : N_WAITING;
  let best: { ms: number; okCount: number; heapPerPending?: number } | undefined;
  for (let repeat = 0; repeat < REPEATS; repeat++) {
    let sample: { ms: number; okCount: number; heapPerPending?: number };
    if (workload === "immediate") {
      const run: Run = (_signal, i) => Promise.resolve(ok(i));
      sample = await burst(subject, run, n);
    } else {
      const deferreds = Array.from({ length: n }, deferred);
      const run: Run = (_signal, i) => (deferreds[i] as Deferred).promise;
      sample = await burst(subject, run, n, () => { for (let i = 0; i < n; i++) (deferreds[i] as Deferred).resolve(ok(i)); });
    }
    const expectedOk = subject.expectedOk(n);
    if (sample.okCount !== expectedOk) throw new Error(`${subject.name} [${workload}]: ${sample.okCount} ok results, expected ${expectedOk} — the bench's model of the lane is wrong`);
    if (best === undefined || sample.ms < best.ms) best = sample;
  }
  const b = best as { ms: number; okCount: number; heapPerPending?: number };
  return { name: subject.name, ms: b.ms, okCount: b.okCount, expectedOk: subject.expectedOk(n), ...(b.heapPerPending !== undefined ? { heapPerPending: b.heapPerPending } : {}) };
};

const runtime = typeof (globalThis as { Bun?: { version: string } }).Bun === "undefined" ? `node ${process.version}` : `bun ${(globalThis as { Bun?: { version: string } }).Bun?.version}`;
console.log(`${runtime}; immediate N=${N_IMMEDIATE.toLocaleString()}, waiting N=${N_WAITING.toLocaleString()}; best of ${REPEATS}; gates: immediate ≤ ${LIMIT_IMMEDIATE}x, waiting ≤ ${LIMIT_WAITING}x baseline${gc === undefined ? "; run with node --expose-gc for heap per pending trigger" : ""}`);
console.log("debounce coalesces the burst (one run); exhaust/switch admit one run and reject or supersede the rest; the others run every trigger.\n");

let failed = false;
for (const workload of ["immediate", "waiting"] as const) {
  const n = workload === "immediate" ? N_IMMEDIATE : N_WAITING;
  const limit = workload === "immediate" ? LIMIT_IMMEDIATE : LIMIT_WAITING;
  console.log(`== ${workload} ==`);
  console.log(`${"lane".padEnd(34)} ${"ms".padStart(9)} ${"ns/trigger".padStart(11)} ${"ratio".padStart(7)} ${"ok".padStart(8)}${gc !== undefined ? "  heap/pending" : ""}`);
  let baseline: number | undefined;
  for (const subject of subjects) {
    const row = await measure(subject, workload);
    baseline ??= row.ms;
    const ratio = row.ms / baseline;
    const heap = row.heapPerPending !== undefined ? `  ${row.heapPerPending.toFixed(0).padStart(8)} B` : "";
    console.log(`${row.name.padEnd(34)} ${row.ms.toFixed(1).padStart(9)} ${((row.ms * 1e6) / n).toFixed(0).padStart(11)} ${ratio.toFixed(2).padStart(6)}x ${String(row.okCount).padStart(8)}${heap}`);
    if (check && subject !== subjects[0] && ratio > limit) {
      failed = true;
      console.error(`FAIL: ${row.name} [${workload}] is ${ratio.toFixed(1)}x the baseline (limit ${limit}x) — fix: look for a per-trigger allocation that grew, an abort listener that is not removed, or an O(n) scan of the waiting queue in src/lanes.ts`);
    }
  }
  console.log("");
}
if (failed) process.exit(1);
