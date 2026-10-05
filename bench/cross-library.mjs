/**
 * Cross-library comparison rows (docs/references/benchmarks.md).
 *
 * Ramda and Effect are NOT dependencies of this repo, which is why this file is
 * plain JavaScript outside the typecheck. To reproduce:
 *   pnpm add -D ramda effect && node bench/cross-library.mjs && pnpm remove ramda effect
 * Rows whose package is not installed are skipped.
 */
const N = 1_000_000;
const inputs = Array.from({ length: N }, (_, i) => ({ qty: i % 10 === 0 ? -1 : (i % 7) + 1, price: 100 + (i % 50) }));

const bench = (name, fn, reps = 5) => {
  let best = Number.POSITIVE_INFINITY;
  let failures = 0;
  for (let r = 0; r < reps; r++) {
    const t0 = performance.now();
    failures = fn();
    best = Math.min(best, performance.now() - t0);
  }
  console.log(`${name.padEnd(44)} ${best.toFixed(1).padStart(8)} ms   (failures=${failures})`);
};
const perItem = (f, isErr) => () => {
  let n = 0;
  for (let i = 0; i < N; i++) if (isErr(f(inputs[i]))) n++;
  return n;
};

const ok = (value) => ({ ok: true, value });
const err = (error) => ({ ok: false, error });
const plain = (x) => {
  if (!(x.qty > 0)) return err("BadQty");
  const t = x.qty * x.price;
  return ok(t > 500 ? t - 50 : t);
};
const thrown = (x) => {
  try {
    if (!(x.qty > 0)) throw new Error("BadQty");
    const t = x.qty * x.price;
    return ok(t > 500 ? t - 50 : t);
  } catch (e) {
    return err(e.message);
  }
};
bench("plain discriminated union (baseline)", perItem(plain, (r) => !r.ok));
bench("throw / try-catch", perItem(thrown, (r) => !r.ok));

const ramda = await import("ramda").catch(() => undefined);
if (ramda !== undefined) {
  const Rm = ramda.default ?? ramda;
  class Ok { constructor(v) { this.value = v; } chain(f) { return f(this.value); } ["fantasy-land/chain"](f) { return f(this.value); } }
  class Err { constructor(e) { this.error = e; } chain() { return this; } ["fantasy-land/chain"]() { return this; } }
  const rail = Rm.pipeWith(Rm.chain)([(x) => (x.qty > 0 ? new Ok(x) : new Err("BadQty")), (x) => new Ok(x.qty * x.price), (t) => new Ok(t > 500 ? t - 50 : t)]);
  const pointFree = Rm.pipeWith(Rm.chain)([
    Rm.ifElse(Rm.propSatisfies(Rm.gt(Rm.__, 0), "qty"), (x) => new Ok(x), Rm.always(new Err("BadQty"))),
    Rm.pipe(Rm.converge(Rm.multiply, [Rm.prop("qty"), Rm.prop("price")]), (t) => new Ok(t)),
    Rm.pipe(Rm.when(Rm.gt(Rm.__, 500), Rm.subtract(Rm.__, 50)), (t) => new Ok(t)),
  ]);
  bench("Ramda pipeWith(chain) + FL Result", perItem(rail, (r) => r instanceof Err));
  bench("Ramda idiomatic point-free", perItem(pointFree, (r) => r instanceof Err));
} else console.log("Ramda not installed — skipped (pnpm add -D ramda)");

const effect = await import("effect").catch(() => undefined);
if (effect !== undefined) {
  const { Effect } = effect;
  const item = (x) => Effect.gen(function* () {
    const a = yield* (x.qty > 0 ? Effect.succeed(x) : Effect.fail("BadQty"));
    const b = yield* Effect.succeed(a.qty * a.price);
    return yield* Effect.succeed(b > 500 ? b - 50 : b);
  });
  bench("Effect.gen + runSync per item", perItem((x) => Effect.runSync(Effect.result(item(x))), (r) => r._tag === "Failure"));
  bench("Effect.forEach batched (1 runSync)", () => Effect.runSync(Effect.forEach(inputs, (x) => Effect.result(item(x)))).filter((r) => r._tag === "Failure").length);
} else console.log("Effect not installed — skipped (pnpm add -D effect)");
