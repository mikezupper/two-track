/**
 * Decoder throughput: two-track's hand-written typeof decoders against the
 * compiled/optimized validators people actually use. Same schema in all four.
 *
 *   pnpm --filter two-track-bench-cross bench      (or: node decoders-vs.mjs [--json])
 *
 * Report only — third-party versions drift, so there is no threshold. The
 * correctness line asserts that all four libraries agree on which objects are
 * valid; disagreement exits 1 because then the timing rows measure different work.
 * two-track is imported from the built dist so the comparison is build vs build.
 */
import { createRequire } from "node:module";
import { D } from "../../dist/index.js";
import { z } from "zod";
import * as v from "valibot";
import { type } from "arktype";

const require = createRequire(import.meta.url);
// Pinned exact versions live in this workspace's package.json (some packages do not export their own package.json).
const pinned = require("./package.json").devDependencies;
const versions = { "two-track": require("../../package.json").version, zod: pinned.zod, valibot: pinned.valibot, arktype: pinned.arktype };

// ---------- the one schema, four ways ----------
const ID = /^u_[0-9a-f]{8}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIP = /^\d{5}$/;

const TT = D.struct({
  id: D.pattern(ID),
  email: D.pattern(EMAIL),
  age: D.max(D.min(D.integer, 0), 150),
  tags: D.array(D.nonEmptyString),
  address: D.struct({ street: D.nonEmptyString, zip: D.pattern(ZIP) }),
  newsletter: D.optional(D.boolean),
});

const ZZ = z.object({
  id: z.string().regex(ID),
  email: z.string().regex(EMAIL),
  age: z.number().int().min(0).max(150),
  tags: z.array(z.string().min(1)),
  address: z.object({ street: z.string().min(1), zip: z.string().regex(ZIP) }),
  newsletter: z.boolean().optional(),
});

const VV = v.object({
  id: v.pipe(v.string(), v.regex(ID)),
  email: v.pipe(v.string(), v.regex(EMAIL)),
  age: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(150)),
  tags: v.array(v.pipe(v.string(), v.nonEmpty())),
  address: v.object({ street: v.pipe(v.string(), v.nonEmpty()), zip: v.pipe(v.string(), v.regex(ZIP)) }),
  newsletter: v.optional(v.boolean()),
});

// ArkType: regexes are expressed directly; "string > 0" is non-empty; the integer range
// uses its bounded-number syntax. `string.email` was NOT used so the email rule is the
// identical regex in all four libraries (ArkType's built-in email is a different, stricter pattern).
const AA = type({
  id: ID,
  email: EMAIL,
  age: "0 <= number.integer <= 150",
  tags: "(string > 0)[]",
  address: { street: "string > 0", zip: ZIP },
  "newsletter?": "boolean",
});

// ---------- data ----------
const N = 200_000;
const JSON_N = 50_000;
const hex = (i) => (i >>> 0).toString(16).padStart(8, "0").slice(-8);
const valid = Array.from({ length: N }, (_, i) => ({
  id: `u_${hex(i * 2654435761)}`,
  email: `user${i}@example.com`,
  age: i % 151,
  tags: i % 3 === 0 ? [] : ["a", `t${i % 7}`],
  address: { street: `${i % 999 + 1} Main St`, zip: String(10000 + (i % 89999)) },
  ...(i % 2 === 0 ? { newsletter: i % 4 === 0 } : {}),
}));
// 10% invalid, each with exactly two field errors (bad age: non-integer; bad zip: 4 digits).
const mixed = valid.map((o, i) => (i % 10 === 0 ? { ...o, age: 12.5, address: { ...o.address, zip: "1234" } } : o));
const jsonStrings = valid.slice(0, JSON_N).map((o) => JSON.stringify(o));

// ---------- runners: each returns the number of VALID objects ----------
const runners = {
  "two-track": (xs) => { let n = 0; for (let i = 0; i < xs.length; i++) if (TT.decode(xs[i]).ok) n++; return n; },
  zod: (xs) => { let n = 0; for (let i = 0; i < xs.length; i++) if (ZZ.safeParse(xs[i]).success) n++; return n; },
  valibot: (xs) => { let n = 0; for (let i = 0; i < xs.length; i++) if (v.safeParse(VV, xs[i]).success) n++; return n; },
  arktype: (xs) => { let n = 0; for (let i = 0; i < xs.length; i++) if (!(AA(xs[i]) instanceof type.errors)) n++; return n; },
};
const jsonRunners = {
  "two-track": (ss) => { let n = 0; for (let i = 0; i < ss.length; i++) if (TT.decode(JSON.parse(ss[i])).ok) n++; return n; },
  zod: (ss) => { let n = 0; for (let i = 0; i < ss.length; i++) if (ZZ.safeParse(JSON.parse(ss[i])).success) n++; return n; },
  valibot: (ss) => { let n = 0; for (let i = 0; i < ss.length; i++) if (v.safeParse(VV, JSON.parse(ss[i])).success) n++; return n; },
  arktype: (ss) => { let n = 0; for (let i = 0; i < ss.length; i++) if (!(AA(JSON.parse(ss[i])) instanceof type.errors)) n++; return n; },
};

// ---------- correctness: every library must classify every object the same way ----------
const classify = {
  "two-track": (x) => TT.decode(x).ok,
  zod: (x) => ZZ.safeParse(x).success,
  valibot: (x) => v.safeParse(VV, x).success,
  arktype: (x) => !(AA(x) instanceof type.errors),
};
let disagreements = 0;
for (let i = 0; i < mixed.length; i += 97) {
  const votes = Object.values(classify).map((f) => f(mixed[i]));
  if (votes.some((b) => b !== votes[0])) disagreements++;
}
const expectedValid = mixed.filter((_, i) => i % 10 !== 0).length;
const counts = Object.fromEntries(Object.entries(classify).map(([k, f]) => [k, mixed.reduce((n, x) => n + (f(x) ? 1 : 0), 0)]));
const agree = disagreements === 0 && Object.values(counts).every((c) => c === expectedValid);
// Two-field accumulation: the first invalid object must yield two issues in each accumulating library.
const bad = mixed[0];
const issueCounts = {
  "two-track": (() => { const r = TT.decode(bad); return r.ok ? 0 : r.error.issues.length; })(),
  zod: ZZ.safeParse(bad).error?.issues.length ?? 0,
  valibot: v.safeParse(VV, bad).issues?.length ?? 0,
  arktype: (() => { const r = AA(bad); return r instanceof type.errors ? r.length : 0; })(),
};

// ---------- timing ----------
const best = (fn, arg, reps = 7) => {
  let b = Number.POSITIVE_INFINITY;
  let out = 0;
  for (let r = 0; r < reps; r++) {
    const t0 = performance.now();
    out = fn(arg);
    b = Math.min(b, performance.now() - t0);
  }
  return { ms: b, out };
};
const rows = Object.keys(runners).map((lib) => {
  const a = best(runners[lib], valid);
  const b = best(runners[lib], mixed);
  const c = best(jsonRunners[lib], jsonStrings);
  return { library: lib, version: versions[lib], validMs: a.ms, invalidMs: b.ms, jsonMs: c.ms, nsPerValid: (a.ms * 1e6) / N, validCount: a.out, mixedValid: b.out, jsonValid: c.out };
});

const runtime = typeof Bun === "undefined" ? `node ${process.version}` : `bun ${Bun.version}`;
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ runtime, N, JSON_N, versions, rows, agreement: { agree, disagreements, counts, expectedValid, issueCounts } }, null, 2));
} else {
  console.log(`${runtime} — decoders: ${N.toLocaleString()} objects valid / 10% invalid (2 field errors each) / ${JSON_N.toLocaleString()} JSON strings, best of 7\n`);
  console.log(`${"library".padEnd(12)} ${"version".padEnd(8)} ${"valid ms".padStart(9)} ${"10%-bad ms".padStart(11)} ${"json ms".padStart(8)} ${"ns/valid obj".padStart(13)}`);
  for (const r of rows) console.log(`${r.library.padEnd(12)} ${r.version.padEnd(8)} ${r.validMs.toFixed(1).padStart(9)} ${r.invalidMs.toFixed(1).padStart(11)} ${r.jsonMs.toFixed(1).padStart(8)} ${r.nsPerValid.toFixed(0).padStart(13)}`);
  console.log(`\ncorrectness: ${agree ? "all four libraries agree" : "DISAGREEMENT"} — valid counts ${JSON.stringify(counts)} (expected ${expectedValid}); issues on the 2-error object ${JSON.stringify(issueCounts)}`);
  const tt = rows[0];
  const fastest = rows.reduce((m, r) => (r.validMs < m.validMs ? r : m));
  console.log(`summary: two-track ${tt.nsPerValid.toFixed(0)} ns/object valid; fastest valid path ${fastest.library} ${fastest.nsPerValid.toFixed(0)} ns; two-track/fastest = ${(tt.validMs / fastest.validMs).toFixed(2)}x`);
}
if (!agree) {
  console.error("decoders-vs: libraries disagree on validity — timing rows would measure different work");
  process.exit(1);
}
