/**
 * `rewriteRelativeImportExtensions` rewrites `.ts` → `.js` in emitted JavaScript
 * but leaves `.ts` specifiers in the emitted declaration files. Consumers who
 * compile with `skipLibCheck: false` and without `allowImportingTsExtensions`
 * then fail on `import ... from "./result.ts"`. This post-build step rewrites
 * relative `.ts` specifiers in dist/**.d.ts to `.js`, which is what the JS
 * next to them actually resolves to. Reported by a downstream consumer.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dist = new URL("../dist", import.meta.url).pathname;
let rewritten = 0;
for (const name of readdirSync(dist)) {
  if (!name.endsWith(".d.ts")) continue;
  const file = join(dist, name);
  const before = readFileSync(file, "utf8");
  const after = before.replace(/(from\s+["']\.\.?\/[^"']+?)\.ts(["'])/g, "$1.js$2").replace(/(import\(["']\.\.?\/[^"']+?)\.ts(["']\))/g, "$1.js$2");
  if (after !== before) {
    writeFileSync(file, after);
    rewritten++;
  }
}
console.log(`fix-dts-extensions: rewrote ${rewritten} declaration file(s)`);
