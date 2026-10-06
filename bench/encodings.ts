/**
 * Benchmark: the cost of the railway, by encoding.
 *
 * Numbers are recorded in docs/references/benchmarks.md. Run `pnpm bench`;
 * `pnpm bench --check` additionally asserts that the library's own combinators
 * stay within RATIO_LIMIT of the plain inline baseline, which is the
 * performance invariant this library promises.
 */
import { R, ok, err, type Result } from "../src/index.ts";

const N = 1_000_000;
const RATIO_LIMIT = 4;
type Input = { readonly qty: number; readonly price: number };
const inputs: Input[] = Array.from({ length: N }, (_, i) => ({ qty: i % 10 === 0 ? -1 : (i % 7) + 1, price: 100 + (i % 50) }));

// Baseline: plain inline two-shape objects, early return.
const parseQty = (x: Input): Result<"BadQty", Input> => (x.qty > 0 ? ok(x) : err("BadQty"));
const price = (x: Input): Result<never, number> => ok(x.qty * x.price);
const discount = (t: number): Result<never, number> => ok(t > 500 ? t - 50 : t);
const inline = (x: Input): Result<"BadQty", number> => {
  const a = parseQty(x);
  if (!a.ok) return a;
  const b = price(a.value);
  if (!b.ok) return b;
  return discount(b.value);
};

// Library combinators (allocates one closure per step).
const combinators = (x: Input): Result<"BadQty", number> => R.andThen(R.andThen(parseQty(x), price), discount);

// Generator do-notation — what this library deliberately does NOT ship.
type Yielded = Result<"BadQty", unknown>;
function safeTry<A>(gen: () => Generator<Yielded, Result<"BadQty", A>, unknown>): Result<"BadQty", A> {
  const it = gen();
  let s = it.next();
  while (!s.done) {
    const r = s.value;
    if (!r.ok) return r;
    s = it.next(r.value);
  }
  return s.value;
}
const generator = (x: Input): Result<"BadQty", number> =>
  safeTry(function* () {
    const a = (yield parseQty(x)) as Input;
    const b = (yield price(a)) as number;
    return discount(b);
  });

// Throw / try-catch.
const thrown = (x: Input): Result<"BadQty", number> => {
  try {
    if (!(x.qty > 0)) throw new Error("BadQty");
    const t = x.qty * x.price;
    return ok(t > 500 ? t - 50 : t);
  } catch {
    return err("BadQty");
  }
};

// Object.freeze on every result.
const frozen = (x: Input): Result<"BadQty", number> => {
  const a = Object.freeze(x.qty > 0 ? ok(x) : err("BadQty" as const));
  if (!a.ok) return a;
  const b = Object.freeze(ok(a.value.qty * a.value.price));
  return Object.freeze(ok(b.value > 500 ? b.value - 50 : b.value));
};

const bench = (name: string, fn: (x: Input) => Result<"BadQty", number>, reps = 7): number => {
  let best = Number.POSITIVE_INFINITY;
  let failures = 0;
  for (let r = 0; r < reps; r++) {
    failures = 0;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) if (!fn(inputs[i] as Input).ok) failures++;
    best = Math.min(best, performance.now() - t0);
  }
  if (failures !== N / 10) throw new Error(`${name}: wrong failure count ${failures}`);
  console.log(`${name.padEnd(44)} ${best.toFixed(1).padStart(8)} ms`);
  return best;
};

console.log(`${typeof Bun === "undefined" ? `node ${process.version}` : `bun ${Bun.version}`}, N=${N.toLocaleString()} items, 3-step railway, best of 7\n`);
const base = bench("inline two-shape objects (baseline)", inline);
const lib = bench("two-track R.andThen combinators", combinators);
bench("throw / try-catch", thrown);
bench("Object.freeze every result", frozen);
bench("generator do-notation (not shipped)", generator);
const ratio = lib / base;
console.log(`\ncombinators / baseline = ${ratio.toFixed(2)}x (limit ${RATIO_LIMIT}x)`);
// --json: the machine-readable form that scripts/record-measurements.mjs stores in docs/references/measurements.json
if (process.argv.includes("--json")) console.log(`JSON:${JSON.stringify({ baselineMs: base, combinatorsMs: lib, ratio })}`);
if (process.argv.includes("--check") && ratio > RATIO_LIMIT) {
  console.error(`FAIL: combinator overhead ${ratio.toFixed(2)}x exceeds ${RATIO_LIMIT}x — fix: remove allocations/closures from the hot path in src/result.ts`);
  process.exit(1);
}
declare const Bun: { readonly version: string } | undefined;
