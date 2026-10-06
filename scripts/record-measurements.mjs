/**
 * Record the headline measurements the docs quote into docs/references/measurements.json.
 *
 * The invariants script (`quoted-measurements`) then checks that every figure quoted in
 * README.md and docs/references/benchmarks.md for a named row matches this file within a
 * tolerance. So: re-record (`pnpm bench:record`), then update the tables to the recorded run.
 * CI does NOT re-record (shared runners are noisy); it checks docs against the committed file.
 *
 * Runs: bench/encodings.ts, bench/lanes.ts, bench/bundles.mjs (both bundlers), and
 * bench/cross/decoders-vs.mjs (needs `pnpm build` first; done here).
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const run = (args) => execFileSync("node", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 });
const jsonLine = (out) => {
  const line = out.split("\n").find((l) => l.startsWith("JSON:"));
  if (line === undefined) throw new Error("bench did not print a JSON: line");
  return JSON.parse(line.slice(5));
};

execFileSync("pnpm", ["build"], { cwd: root, stdio: "ignore" });
const encodings = jsonLine(run(["bench/encodings.ts", "--json"]));
const lanes = jsonLine(run(["bench/lanes.ts", "--json"]));
const bundlesRolldown = JSON.parse(run(["bench/bundles.mjs", "--json"]).trim().split("\n").filter((l) => l.startsWith("{") || l.startsWith(" ") || l.startsWith("}")).join("\n"));
const bundlesEsbuild = JSON.parse(run(["bench/bundles.mjs", "--bundler", "esbuild", "--json"]).trim().split("\n").filter((l) => l.startsWith("{") || l.startsWith(" ") || l.startsWith("}")).join("\n"));
const decoders = JSON.parse(run(["bench/cross/decoders-vs.mjs", "--json"]));
const row = (library) => decoders.rows.find((r) => r.library === library);

const measurements = {
  recordedAt: new Date().toISOString(),
  runtime: `node ${process.version}`,
  entries: {
    "encodings.node.baselineMs": encodings.baselineMs,
    "encodings.node.combinatorsMs": encodings.combinatorsMs,
    "decoders.node.interpreterNs": row("two-track").nsPerValid,
    "decoders.node.compiledNs": row("two-track+compile").nsPerValid,
    "decoders.node.zodNs": row("zod").nsPerValid,
    "decoders.node.valibotNs": row("valibot").nsPerValid,
    "decoders.node.arktypeNs": row("arktype").nsPerValid,
    "bundles.rolldown.full": bundlesRolldown.full.minified,
    "bundles.esbuild.full": bundlesEsbuild.full.minified,
    "bundles.esbuild.resultDirect": bundlesEsbuild.resultDirect.minified,
    "bundles.esbuild.decoderDirect": bundlesEsbuild.decoderDirect.minified,
    "bundles.esbuild.primitiveDirect": bundlesEsbuild.primitiveDirect.minified,
    "lanes.node.semaphoreImmediateRatio": lanes["immediate.semaphore(16).run.ratio"],
    "lanes.node.switchImmediateRatio": lanes["immediate.switchLane.ratio"],
  },
};
writeFileSync(`${root}docs/references/measurements.json`, `${JSON.stringify(measurements, null, 2)}\n`);
console.log(`recorded ${Object.keys(measurements.entries).length} measurements at ${measurements.recordedAt}`);
for (const [k, v] of Object.entries(measurements.entries)) console.log(`  ${k.padEnd(40)} ${typeof v === "number" ? v.toFixed(2) : v}`);
