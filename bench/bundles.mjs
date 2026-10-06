/** Consumer-sized ESM bundles: pinned bundlers, minified, no forced side-effect overrides. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { rolldown } from "rolldown";
import { build } from "esbuild";

const arg = process.argv.indexOf("--dir");
const dist = arg < 0 ? fileURLToPath(new URL("../dist", import.meta.url)) : resolve(process.argv[arg + 1]);
const entry = JSON.stringify(join(dist, "index.js"));
const engineIndex = process.argv.indexOf("--bundler");
const engine = engineIndex < 0 ? "rolldown" : process.argv[engineIndex + 1];
if (engine !== "rolldown" && engine !== "esbuild") throw new Error("--bundler must be rolldown or esbuild");
const cases = {
  result: `import { R, ok, err } from ${entry}; export { ok, err }; export const bind = R.andThen;`,
  option: `import { O } from ${entry}; export const map = O.map; export const some = O.some; export const none = O.none;`,
  decoder: `import { D } from ${entry}; const User = D.struct({ name: D.nonEmptyString, age: D.integer }); export const decode = User.decode;`,
  primitive: `import { D } from ${entry}; export const decode = D.number.decode;`,
  interop: `import { Async } from ${entry}; export const fromPromise = Async.fromPromise;`,
  concurrent: `import { Async } from ${entry}; export const map = Async.mapConcurrent;`,
  switch: `import { Lane } from ${entry}; export const switchLane = Lane.switchLane;`,
  full: `export * from ${entry};`,
  testing: `export * from ${JSON.stringify(join(dist, "testing.js"))};`,
  resultDirect: `export { andThen as bind, ok, err } from ${JSON.stringify(join(dist, "result.js"))};`,
  decoderDirect: `import { struct, nonEmptyString, integer } from ${JSON.stringify(join(dist, "decode.js"))}; const User = struct({ name: nonEmptyString, age: integer }); export const decode = User.decode;`,
  primitiveDirect: `import { number } from ${JSON.stringify(join(dist, "decode.js"))}; export const decode = number.decode;`,
  interopDirect: `export { fromPromise } from ${JSON.stringify(join(dist, "async.js"))};`,
  concurrentDirect: `export { mapConcurrent as map } from ${JSON.stringify(join(dist, "async.js"))};`,
  switchDirect: `export { switchLane } from ${JSON.stringify(join(dist, "lanes.js"))};`,
};
const work = mkdtempSync(join(tmpdir(), "two-track-bundles-"));
const sizes = {};
// `full` was raised from 15,000 to 16,000 on 2026-10-05 when `isoDate` became strict ISO-8601 with
// calendar validation and `oneOf` started reporting every alternative's issues (~1 kB of real
// behaviour). Selective consumers did not move; the full-surface budget is a regression tripwire,
// not a target.
// 2026-10-06 (decision 0014): the decoder protocol changed for speed (value-or-Failure, inline
// primitive checks with their messages, struct field descriptors) and `D.compile` was added.
// Selective decoder consumers grew ~1 kB (primitive 301 → 1,026 B, struct 1,119 → 2,286 B) for
// 1.2–1.5x interpreter speed; `compile` itself is NOT retained unless imported (verified with
// esbuild: no `new Function` in a struct-only consumer). The full-surface bundle includes the
// compiler (~4 kB). Budgets below are tripwires set ~10% above those measurements.
// 2026-10-06 (later): `compile` gained native taggedUnion/record emitters (+~1.8 kB in the full
// surface; compile is still tree-shaken from selective consumers), and `primIssue` gained the inline
// regex branch, which every primitive consumer carries (+~120 B: primitive 1,026 → ~1,150, struct
// 2,286 → ~2,400). Budgets ~10% above those measurements.
const budgets = { resultDirect: 160, decoderDirect: 2700, primitiveDirect: 1300, interopDirect: 220, concurrentDirect: 800, switchDirect: 900, full: 24_500, testing: 1600 };
try {
  for (const [name, code] of Object.entries(cases)) {
    const input = join(work, `${name}.mjs`);
    writeFileSync(input, code);
    let js;
    if (engine === "esbuild") {
      const output = await build({ entryPoints: [input], bundle: true, format: "esm", minify: true, write: false, target: "es2023" });
      js = output.outputFiles[0].text;
    } else {
      const bundle = await rolldown({ input });
      let output;
      try { output = await bundle.generate({ format: "esm", minify: true }); }
      finally { await bundle.close(); }
      js = output.output.filter((item) => item.type === "chunk").map((item) => item.code).join("\n");
    }
    sizes[name] = { minified: Buffer.byteLength(js), gzip: gzipSync(js, { level: 9 }).length, brotli: brotliCompressSync(js).length };
    const api = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
    let valid;
    if (name.startsWith("result")) valid = api.bind(api.ok(1), (n) => api.ok(n + 1)).value === 2 && api.err("e").error === "e";
    else if (name === "option") valid = api.map(api.some(1), (n) => n + 1).value === 2 && api.none.some === false;
    else if (name.startsWith("decoder")) valid = api.decode({ name: "Ada", age: 37 }).value.age === 37;
    else if (name.startsWith("primitive")) valid = api.decode(1).value === 1 && api.decode("bad").ok === false;
    else if (name.startsWith("interop")) valid = (await api.fromPromise(Promise.resolve(1), () => "failed")).value === 1;
    else if (name.startsWith("concurrent")) valid = (await api.map([1, 2], (n) => ({ ok: true, value: n }), { concurrency: 1 })).value.length === 2;
    else if (name.startsWith("switch")) valid = (await api.switchLane(async (_signal, n) => ({ ok: true, value: n }))(1)).value === 1;
    else if (name === "testing") valid = api.structuralEq({ n: 1 }, { n: 1 });
    else valid = api.R.isOk(api.ok(1)) && typeof api.Lane.semaphore === "function";
    if (!valid) throw new Error(`${engine}/${name}: bundled consumer failed its runtime check`);
    if (process.argv.includes("--check") && budgets[name] !== undefined && sizes[name].minified > budgets[name]) {
      throw new Error(`${engine}/${name}: ${sizes[name].minified} bytes exceeds ${budgets[name]} — fix: remove retained exports or unnecessary runtime code; see decision 0013`);
    }
  }
  console.log(`bundler: ${engine}`);
  if (process.argv.includes("--json")) console.log(JSON.stringify(sizes, null, 2));
  else console.table(sizes);
} finally {
  rmSync(work, { recursive: true, force: true });
}
