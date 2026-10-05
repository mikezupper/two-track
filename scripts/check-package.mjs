/**
 * Consumer check: pack the library exactly as npm would, install the tarball
 * into a scratch project, and verify what downstream builds actually do:
 *   1. ESM import of "two-track" and "two-track/testing"
 *   2. require("two-track") (Node ≥ 22.12 require(esm)) and "two-track/package.json"
 *   3. `tsc` with skipLibCheck: false under TypeScript 6 AND TypeScript 7
 * Reported problems 1–3 from a downstream consumer are each one of these steps.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), "two-track-consumer-"));
const sh = (cmd, args, cwd = work) => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.error(`${cmd} ${args.join(" ")} failed\n${r.stdout}${r.stderr}`);
    process.exit(1);
  }
  return r.stdout;
};

try {
  const tarball = execFileSync("npm", ["pack", "--silent", "--pack-destination", work], { cwd: root, encoding: "utf8" }).trim().split("\n").pop();
  writeFileSync(join(work, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));
  sh("npm", ["install", "--silent", "--no-audit", "--no-fund", join(work, tarball), "fast-check@^4", "typescript@^6.0.0", "@types/node@^26"]);
  const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

  // 1 + 2: runtime resolution
  writeFileSync(join(work, "esm.mjs"), `
    import { ok, R, D, Async, Lane } from "two-track";
    import { arbResult } from "two-track/testing";
    import { createRequire } from "node:module";
    const require = createRequire(import.meta.url);
    const cjs = require("two-track");
    const pkg = require("two-track/package.json");
    if (!R.isOk(ok(1)) || typeof D.struct !== "function" || typeof Async.retry !== "function" || typeof Lane.switchLane !== "function") throw new Error("esm surface");
    if (typeof cjs.ok !== "function") throw new Error("require(esm) surface");
    if (pkg.version !== ${JSON.stringify(version)}) throw new Error("package.json export");
    if (typeof arbResult !== "function") throw new Error("testing entry");
    console.log("runtime: ok");
  `);
  console.log(sh("node", ["esm.mjs"]).trim());

  // 3: types under TS 6 and TS 7 with skipLibCheck: false
  writeFileSync(join(work, "consumer.ts"), `
    import { ok, err, R, D, Async, Lane, type Result, type AsyncResult, type Infer } from "two-track";
    import fc from "fast-check";
    import { decoderRoundTrip } from "two-track/testing";
    const Qty = D.brand(D.min(D.integer, 1), "Qty");
    type Qty = Infer<typeof Qty>;
    const parse = (s: string): Result<"bad", Qty> => R.mapErr(Qty.decode(Number(s)), () => "bad" as const);
    const total = (xs: ReadonlyArray<string>): Result<"bad", number> => R.map(R.traverse(xs, parse), (q) => q.reduce((a, b) => a + b, 0));
    const fetchIt = (signal: AbortSignal): AsyncResult<"net", number> => Async.tryPromise(async () => 1, () => "net" as const, signal);
    const retried = (c: AbortController) => Async.retry((_, s) => fetchIt(s), { attempts: 2, delay: () => 1, retriable: () => true, signal: c.signal });
    const lane = Lane.exhaustLane((signal) => fetchIt(signal));
    decoderRoundTrip(fc, Qty, fc.integer({ min: 1 }).map((n) => n as Qty));
    export const api = { total, retried, lane, e: err("x") };
    export const t: Result<"bad", number> = total(["1"]);
    export const u: AsyncResult<"net" | Async.Aborted, number> = retried(new AbortController());
    export const v: AsyncResult<"net" | Lane.Busy, number> = lane();
    void ok(1);
  `);
  const tsconfig = (ts) => JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, skipLibCheck: false, noEmit: true, types: ["node"] }, files: ["consumer.ts"] });
  writeFileSync(join(work, "tsconfig.json"), tsconfig());
  const ts6 = sh("node", [join(work, "node_modules/typescript/bin/tsc"), "-v"]).trim();
  sh("node", [join(work, "node_modules/typescript/bin/tsc"), "-p", "."]);
  console.log(`types (${ts6}, skipLibCheck:false): ok`);
  sh("npx", ["--yes", "-p", "typescript@^7.0.2", "tsc", "-p", "."]);
  console.log("types (TypeScript 7, skipLibCheck:false): ok");
  console.log("check-package: ok");
} finally {
  rmSync(work, { recursive: true, force: true });
}
