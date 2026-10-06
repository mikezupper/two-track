/**
 * Repository invariants — the mechanical enforcement of docs/design-docs/core-beliefs.md.
 *
 * Each violation message says WHAT is wrong and HOW to fix it, because the
 * reader is usually an agent that will apply the fix without further context.
 * Run via `pnpm lint:invariants`; also executed by test/architecture.test.ts.
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";

export type Violation = { readonly file: string; readonly line: number; readonly rule: string; readonly message: string };

type Rule = { readonly id: string; readonly pattern: RegExp; readonly allow: ReadonlyArray<string>; readonly fix: string };

/** Files in src/ that may contain a construct, and why. Keep this list short and justified. */
const SRC_RULES: ReadonlyArray<Rule> = [
  { id: "no-throw", pattern: /\bthrow\b/, allow: ["src/match.ts"], fix: "return err(...) on the error track; `throw` is reserved for assertNever (a defect)" },
  { id: "no-try", pattern: /\btry\s*\{/, allow: ["src/result.ts", "src/async.ts", "src/decode-core.ts", "src/decode-compile.ts"], fix: "wrap the throwing call with R.fromThrowable / Async.tryPromise at the interop edge" },
  { id: "no-catch-method", pattern: /\.catch\(/, allow: [], fix: "use Async.fromPromise(promise, onReject) — a railway promise never rejects" },
  { id: "no-any", pattern: /:\s*any\b|\bas any\b|<any>/, allow: [], fix: "use `unknown` and decode it, or a precise type" },
  { id: "no-ts-suppression", pattern: /@ts-(ignore|expect-error|nocheck)/, allow: [], fix: "fix the type error; suppressions hide the proof the compiler gives you" },
  { id: "no-generators", pattern: /function\s*\*|\byield\b/, allow: [], fix: "generators cost 40-80x on the railway (decision 0002); use early return or Async.andThen" },
  { id: "no-freeze", pattern: /Object\.freeze/, allow: [], fix: "immutability is a compile-time property here (decision 0003): use readonly types" },
  { id: "no-class", pattern: /\bclass\s+[A-Z]/, allow: [], fix: "data are plain objects with a discriminant; behaviour is a function (decision 0001)" },
  { id: "no-console", pattern: /\bconsole\./, allow: [], fix: "the library never logs; return the information on the error track" },
  { id: "no-platform-time", pattern: /Date\.now\(|new Date\(\)|performance\.now\(/, allow: ["src/capabilities.ts"], fix: "take a Clock capability (Cap.Clock) instead of reading the platform clock" },
  { id: "no-platform-random", pattern: /Math\.random\(|randomUUID\(/, allow: ["src/capabilities.ts"], fix: "take a Random / IdGen capability instead" },
  { id: "no-platform-timers", pattern: /\bsetTimeout\(|\bsetInterval\(/, allow: ["src/capabilities.ts", "src/async.ts"], fix: "take a Sleeper capability; timers belong to capabilities.ts (withTimeout is the documented exception)" },
  { id: "no-node-imports", pattern: /from\s+["']node:/, allow: [], fix: "src/ must run in browsers and edge runtimes; use web-standard APIs only" },
  { id: "no-unknown-cast", pattern: /as unknown as/, allow: ["src/result.ts", "src/async.ts", "src/decode-core.ts", "src/decode-internal.ts", "src/decode-compile.ts"], fix: "a double cast forges a type; only the listed files may use it, each occurrence justified by a comment" },
  { id: "no-non-null-assertion", pattern: /[A-Za-z0-9_)\]]!\./, allow: [], fix: "narrow with a check or an Option; `!` is an unproven claim" },
  { id: "no-let-for-mutation-escape", pattern: /\bexport\s+let\b/, allow: [], fix: "exported bindings are immutable: export const" },
];

/** Dependency direction: a file may only import from the layers listed. */
const LAYERS: Readonly<Record<string, ReadonlyArray<string>>> = {
  "src/brand.ts": [],
  "src/fn.ts": [],
  "src/tagged.ts": [],
  "src/match.ts": [],
  "src/result.ts": [],
  "src/option.ts": ["src/result.ts"],
  "src/capabilities.ts": [],
  "src/decode-internal.ts": ["src/option.ts", "src/result.ts"],
  "src/decode-core.ts": ["src/brand.ts", "src/option.ts", "src/result.ts", "src/decode-internal.ts"],
  "src/decode-dates.ts": ["src/decode-core.ts", "src/result.ts"],
  "src/decode-compile.ts": ["src/option.ts", "src/decode-internal.ts"],
  "src/decode.ts": ["src/decode-core.ts", "src/decode-dates.ts", "src/decode-compile.ts"],
  "src/async.ts": ["src/result.ts", "src/capabilities.ts", "src/tagged.ts"],
  "src/lanes.ts": ["src/result.ts", "src/tagged.ts", "src/capabilities.ts", "src/async.ts"],
  "src/testing.ts": ["src/result.ts", "src/option.ts", "src/decode.ts"],
  "src/index.ts": ["*"],
};

const MAX_SRC_LINES = 400;

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === "node_modules" || entry === "dist" || entry === ".git" || entry === "coverage") continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};

export const checkInvariants = (root: string): Violation[] => {
  const violations: Violation[] = [];
  const rel = (p: string): string => relative(root, p).split("\\").join("/");

  // ---- 1. zero runtime dependencies ----
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    violations.push({ file: "package.json", line: 1, rule: "zero-runtime-deps", message: `runtime dependency "${name}" is not allowed — fix: implement the helper in src/ (core belief #1) or make it a devDependency if it is tooling` });
  }
  for (const name of Object.keys(pkg.peerDependencies ?? {})) {
    violations.push({ file: "package.json", line: 1, rule: "zero-runtime-deps", message: `peer dependency "${name}" is not allowed — fix: the library must be usable with nothing else installed` });
  }

  // ---- 2. source rules ----
  const srcFiles = walk(join(root, "src")).filter((f) => f.endsWith(".ts"));
  for (const file of srcFiles) {
    const name = rel(file);
    const lines = readFileSync(file, "utf8").split("\n");
    if (lines.length > MAX_SRC_LINES) {
      violations.push({ file: name, line: lines.length, rule: "max-file-lines", message: `${lines.length} lines > ${MAX_SRC_LINES} — fix: split the module along a natural seam and update ARCHITECTURE.md` });
    }
    lines.forEach((text, i) => {
      const trimmed = text.trim();
      if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/**")) return; // comments may discuss banned constructs
      for (const rule of SRC_RULES) {
        if (rule.pattern.test(text) && !rule.allow.includes(name)) {
          violations.push({ file: name, line: i + 1, rule: rule.id, message: `${text.trim()} — fix: ${rule.fix}` });
        }
      }
    });

    // ---- 3. dependency direction ----
    const allowed = LAYERS[name];
    if (allowed === undefined) {
      violations.push({ file: name, line: 1, rule: "layer-registered", message: `new module is not registered — fix: add it to LAYERS in scripts/invariants.ts and to the module table in ARCHITECTURE.md` });
    } else if (!allowed.includes("*")) {
      lines.forEach((text, i) => {
        const m = /from\s+["'](\.\.?\/[^"']+)["']/.exec(text);
        if (m === null) return;
        const target = rel(resolve(dirname(file), m[1] as string));
        if (!allowed.includes(target)) {
          violations.push({ file: name, line: i + 1, rule: "layer-direction", message: `imports ${target}, which is outside its allowed layer set [${allowed.join(", ")}] — fix: depend only on lower layers (see ARCHITECTURE.md) or move the shared piece down` });
        }
      });
    }
  }

  // ---- 3a. ARCHITECTURE.md's module table carries real line counts (core belief 3: measured, not remembered) ----
  const archFile = join(root, "ARCHITECTURE.md");
  if (existsSync(archFile)) {
    readFileSync(archFile, "utf8").split("\n").forEach((text, i) => {
      const m = /^\| `src\/([a-z-]+\.ts)` \|.*\| (\d+) \|\s*$/.exec(text);
      if (m === null) return;
      const file = join(root, "src", m[1] as string);
      if (!existsSync(file)) return; // the module-table-vs-files rule reports that separately
      const actual = readFileSync(file, "utf8").split("\n").length;
      const claimed = Number(m[2]);
      const tolerance = Math.max(40, Math.round(actual * 0.25));
      if (Math.abs(actual - claimed) > tolerance) {
        violations.push({ file: "ARCHITECTURE.md", line: i + 1, rule: "architecture-line-counts", message: `src/${m[1]} is listed as ${claimed} lines but has ${actual} — fix: update the Lines column (tolerance ±${tolerance}); numbers in docs are measured, not remembered` });
      }
    });
  }

  // ---- 3b. time-dependent modules: every export has a property test ----
  // Example tests show the cases we thought of; the subtle cancellation bugs live in
  // the cases we did not. Each exported function of async.ts / lanes.ts / capabilities.ts
  // must be exercised in the module's *.properties.test.ts file (fast-check).
  for (const mod of ["async", "lanes", "capabilities"]) {
    const srcFile = join(root, "src", `${mod}.ts`);
    const propFile = join(root, "test", `${mod}.properties.test.ts`);
    if (!existsSync(srcFile)) continue;
    if (!existsSync(propFile)) {
      violations.push({ file: `test/${mod}.properties.test.ts`, line: 1, rule: "property-tests-exist", message: `missing — fix: add fast-check property tests for src/${mod}.ts (core belief 8: laws are tests)` });
      continue;
    }
    const props = readFileSync(propFile, "utf8");
    if (!/\bfc\.(assert|asyncProperty|property)\b/.test(props)) {
      violations.push({ file: `test/${mod}.properties.test.ts`, line: 1, rule: "property-tests-exist", message: `contains no fast-check property — fix: use fc.assert(fc.asyncProperty(...)) over generated event sequences` });
    }
    const exported = [...readFileSync(srcFile, "utf8").matchAll(/^export (?:const|function|async function) ([A-Za-z_][A-Za-z0-9_]*)/gm)].map((m) => m[1] as string);
    for (const name of exported) {
      if (/^[A-Z]/.test(name)) continue; // tagged-error constructors and types are data, not behaviour
      if (!new RegExp(`\\b${name}\\b`).test(props)) {
        violations.push({ file: `test/${mod}.properties.test.ts`, line: 1, rule: "property-test-coverage", message: `src/${mod}.ts exports \`${name}\` but the property test file never mentions it — fix: add a property for its invariants (see the downstream bug report in docs/exec-plans/completed/0002-downstream-findings.md)` });
      }
    }
  }

  // ---- 4. docs are a system of record: links resolve, decisions are indexed ----
  const mdFiles = ["AGENTS.md", "ARCHITECTURE.md", "README.md", ...walk(join(root, "docs")).filter((f) => f.endsWith(".md")).map(rel)];
  for (const name of mdFiles) {
    const file = join(root, name);
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((text, i) => {
      for (const m of text.matchAll(/\]\((?!https?:|mailto:|#)([^)#\s]+)(?:#[^)]*)?\)/g)) {
        const target = resolve(dirname(file), m[1] as string);
        if (!existsSync(target)) {
          violations.push({ file: name, line: i + 1, rule: "doc-link-resolves", message: `link to ${m[1]} does not resolve — fix: correct the path or restore the file; docs are the system of record` });
        }
      }
    });
  }
  const decisionsDir = join(root, "docs/design-docs/decisions");
  const indexFile = join(root, "docs/design-docs/index.md");
  if (existsSync(decisionsDir) && existsSync(indexFile)) {
    const index = readFileSync(indexFile, "utf8");
    for (const d of readdirSync(decisionsDir).filter((f) => f.endsWith(".md"))) {
      if (!index.includes(d)) violations.push({ file: "docs/design-docs/index.md", line: 1, rule: "decision-indexed", message: `decision ${d} is not listed — fix: add a row with its status and one-line summary` });
    }
  }
  const activePlans = join(root, "docs/exec-plans/active");
  if (existsSync(activePlans)) {
    for (const p of readdirSync(activePlans).filter((f) => f.endsWith(".md"))) {
      const text = readFileSync(join(activePlans, p), "utf8");
      if (!/^## Progress/m.test(text) || !/^## Decision log/m.test(text)) {
        violations.push({ file: `docs/exec-plans/active/${p}`, line: 1, rule: "plan-shape", message: `an active plan needs "## Progress" and "## Decision log" sections — fix: see docs/exec-plans/README.md` });
      }
    }
  }

  return violations;
};

export const formatViolations = (vs: ReadonlyArray<Violation>): string =>
  vs.map((v) => `${v.file}:${v.line}: [${v.rule}] ${v.message}`).join("\n");
