import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { check, defaultConfig, formatFinding } from "../src/index.ts";

const fixtures = join(import.meta.dirname, "fixtures");
const repoRoot = join(import.meta.dirname, "..", "..", "..");

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
};

/** `// expect: a, b` annotations → set of "relpath:line:rule". */
const expectedFrom = (projectDir: string): Set<string> => {
  const out = new Set<string>();
  for (const file of walk(join(projectDir, "src"))) {
    const rel = file.slice(projectDir.length + 1);
    readFileSync(file, "utf8").split("\n").forEach((text, i) => {
      const m = /\/\/\s*expect:\s*([a-z-]+(?:\s*,\s*[a-z-]+)*)/.exec(text);
      if (m === null) return;
      for (const rule of (m[1] as string).split(",").map((s) => s.trim())) out.add(`${rel}:${i + 1}:${rule}`);
    });
  }
  return out;
};

describe("violations fixture", () => {
  const projectDir = join(fixtures, "violations");
  const report = check({ projectDir });

  it("loads", () => {
    expect(report.ok).toBe(true);
  });

  it("reports exactly the annotated (file, line, rule) set — nothing missing, nothing extra", () => {
    if (!report.ok) throw new Error(report.error);
    const actual = new Set(report.findings.map((f) => `${f.file}:${f.line}:${f.rule}`));
    const expected = expectedFrom(projectDir);
    const missing = [...expected].filter((e) => !actual.has(e));
    const extra = [...actual].filter((a) => !expected.has(a));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it("counts suppressions and classifies severities", () => {
    if (!report.ok) throw new Error(report.error);
    expect(report.summary.allowed).toBe(1);
    const bySeverity = (s: string) => report.findings.filter((f) => f.severity === s).map((f) => f.rule);
    expect(new Set(bySeverity("review"))).toEqual(new Set(["review-decode-unknown", "review-unwrap-or", "fetch-needs-signal"]));
    expect(report.summary.errors).toBeGreaterThan(20);
  });

  it("every finding carries a fix", () => {
    if (!report.ok) throw new Error(report.error);
    for (const f of report.findings) {
      expect(f.fix.length).toBeGreaterThan(10);
      expect(formatFinding(f)).toMatch(/^src\/.+:\d+:\d+: \[[a-z-]+\] .+ — fix: .+$/);
    }
  });
});

describe("compliant fixture", () => {
  it("produces zero errors (review items allowed)", () => {
    const report = check({ projectDir: join(fixtures, "compliant") });
    if (!report.ok) throw new Error(report.error);
    expect(report.findings.filter((f) => f.severity === "error").map(formatFinding)).toEqual([]);
    expect(report.summary.files).toBe(6);
  });
});

describe("the library's own example", () => {
  it("examples/checkout.ts has zero errors when its re-brand helper file is a brandFiles module", () => {
    const report = check({
      projectDir: repoRoot,
      config: { ...defaultConfig, layers: { ...defaultConfig.layers, root: ["examples/checkout.ts"] }, brandFiles: ["examples/checkout.ts"], include: ["examples/checkout.ts"] },
    });
    if (!report.ok) throw new Error(report.error);
    expect(report.findings.filter((f) => f.severity === "error").map(formatFinding)).toEqual([]);
    expect(report.summary.files).toBe(1);
  });
});

describe("the checker's own source", () => {
  it("passes its own rules (with documented allowances)", () => {
    const report = check({ projectDir: join(import.meta.dirname, ".."), project: "tsconfig.self.json" });
    if (!report.ok) throw new Error(report.error);
    expect(report.findings.filter((f) => f.severity === "error").map(formatFinding)).toEqual([]);
    expect(report.summary.allowed).toBe(1);
  });
});

describe("error paths", () => {
  it("reports a missing tsconfig with a fix", () => {
    const report = check({ projectDir: join(fixtures, "nope") });
    expect(report.ok).toBe(false);
    if (!report.ok) expect(report.error).toMatch(/tsconfig not found — fix:/);
  });
});
