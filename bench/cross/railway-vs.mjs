/**
 * The same three-step railway (parse quantity → price → discount, 1M items, 10%
 * failures) across approaches: a plain discriminated union, two-track's own
 * combinators (from the built dist), exceptions, Ramda, and Effect.
 *
 *   node railway-vs.mjs
 *
 * Report only — no thresholds; the library's own gate is the root bench:check
 * ratio (combinators vs inline). Ramda and Effect are devDependencies of this
 * workspace only; the library root keeps zero runtime dependencies.
 */
import { createRequire } from "node:module";
import { R, ok, err } from "../../dist/index.js";
import * as RamdaNs from "ramda";
import { Effect } from "effect";

const require = createRequire(import.meta.url);
const pinned = require("./package.json").devDependencies;
const versions = { "two-track": require("../../package.json").version, ramda: pinned.ramda, effect: pinned.effect };
const Rm = RamdaNs.default ?? RamdaNs;

const N = 1_000_000;
const inputs = Array.from({ length: N }, (_, i) => ({ qty: i % 10 === 0 ? -1 : (i % 7) + 1, price: 100 + (i % 50) }));
const EXPECTED_FAILURES = N / 10;

const rows = [];
const bench = (name, fn, reps = 5) => {
  let best = Number.POSITIVE_INFINITY;
  let failures = 0;
  for (let r = 0; r < reps; r++) {
    const t0 = performance.now();
    failures = fn();
    best = Math.min(best, performance.now() - t0);
  }
  if (failures !== EXPECTED_FAILURES) {
    console.error(`${name}: wrong failure count ${failures} (expected ${EXPECTED_FAILURES})`);
    process.exit(1);
  }
  rows.push({ name, ms: best });
  console.log(`${name.padEnd(44)} ${best.toFixed(1).padStart(8)} ms`);
};
const perItem = (f, isErr) => () => {
  let n = 0;
  for (let i = 0; i < N; i++) if (isErr(f(inputs[i]))) n++;
  return n;
};

// plain discriminated union, early return (the baseline every other row is compared to)
const plain = (x) => {
  if (!(x.qty > 0)) return err("BadQty");
  const t = x.qty * x.price;
  return ok(t > 500 ? t - 50 : t);
};
// two-track combinators from the built package
const parseQty = (x) => (x.qty > 0 ? ok(x) : err("BadQty"));
const price = (x) => ok(x.qty * x.price);
const discount = (t) => ok(t > 500 ? t - 50 : t);
const combinators = (x) => R.andThen(R.andThen(parseQty(x), price), discount);
// exceptions as control flow
const thrown = (x) => {
  try {
    if (!(x.qty > 0)) throw new Error("BadQty");
    const t = x.qty * x.price;
    return ok(t > 500 ? t - 50 : t);
  } catch (e) {
    return err(e.message);
  }
};
// Ramda over a Fantasy Land Result
class Ok { constructor(v) { this.value = v; } chain(f) { return f(this.value); } ["fantasy-land/chain"](f) { return f(this.value); } }
class Err { constructor(e) { this.error = e; } chain() { return this; } ["fantasy-land/chain"]() { return this; } }
const rail = Rm.pipeWith(Rm.chain)([(x) => (x.qty > 0 ? new Ok(x) : new Err("BadQty")), (x) => new Ok(x.qty * x.price), (t) => new Ok(t > 500 ? t - 50 : t)]);
const pointFree = Rm.pipeWith(Rm.chain)([
  Rm.ifElse(Rm.propSatisfies(Rm.gt(Rm.__, 0), "qty"), (x) => new Ok(x), Rm.always(new Err("BadQty"))),
  Rm.pipe(Rm.converge(Rm.multiply, [Rm.prop("qty"), Rm.prop("price")]), (t) => new Ok(t)),
  Rm.pipe(Rm.when(Rm.gt(Rm.__, 500), Rm.subtract(Rm.__, 50)), (t) => new Ok(t)),
]);
// Effect 4: Effect.gen + Effect.result (Success | Failure) + runSync
const item = (x) => Effect.gen(function* () {
  const a = yield* (x.qty > 0 ? Effect.succeed(x) : Effect.fail("BadQty"));
  const b = yield* Effect.succeed(a.qty * a.price);
  return yield* Effect.succeed(b > 500 ? b - 50 : b);
});

const runtime = typeof Bun === "undefined" ? `node ${process.version}` : `bun ${Bun.version}`;
console.log(`${runtime} — railway: N=${N.toLocaleString()} items, 3 steps, 10% failures, best of 5 (two-track ${versions["two-track"]}, ramda ${versions.ramda}, effect ${versions.effect})\n`);
bench("plain discriminated union (baseline)", perItem(plain, (r) => !r.ok));
bench("two-track R.andThen (built dist)", perItem(combinators, (r) => !r.ok));
bench("throw / try-catch", perItem(thrown, (r) => !r.ok));
bench("Ramda pipeWith(chain) + FL Result", perItem(rail, (r) => r instanceof Err));
bench("Ramda idiomatic point-free", perItem(pointFree, (r) => r instanceof Err));
bench("Effect.gen + runSync per item", perItem((x) => Effect.runSync(Effect.result(item(x))), (r) => r._tag === "Failure"));
bench("Effect.forEach batched (1 runSync)", () => Effect.runSync(Effect.forEach(inputs, (x) => Effect.result(item(x)))).filter((r) => r._tag === "Failure").length);

const base = rows[0].ms;
console.log(`\nsummary: ratios vs baseline — ${rows.slice(1).map((r) => `${r.name.split(" (")[0]} ${(r.ms / base).toFixed(1)}x`).join("; ")}`);
