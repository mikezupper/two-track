import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config.ts";
import { check } from "../src/index.ts";
import { loadProgram } from "../src/program.ts";

const dirs: string[] = [];
const project = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "ttc-program-"));
  dirs.push(dir);
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/a.ts"), "export const a = 1;");
  writeFileSync(join(dir, "src/b.ts"), "export const b = 2;");
  return dir;
};
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("project loading", () => {
  it("reports unreadable tsconfig paths with a fix", () => {
    const dir = project();
    mkdirSync(join(dir, "tsconfig.json"));
    const report = check({ projectDir: dir });
    expect(report.ok).toBe(false);
    if (!report.ok) expect(report.error).toMatch(/— fix:/);
  });

  it.each([
    '{"compilerOptions":{"target":"invalid"},"include":["src"]}',
    '{"compilerOptions":{"unknownCompilerOption":true},"include":["src"]}',
    '{"extends":"./missing.json","include":["src"]}',
    '{"include":["nothing/**/*.ts"]}',
    '{ invalid JSON',
  ])("rejects tsconfig diagnostics instead of reporting a clean project: %s", (config) => {
    const dir = project();
    writeFileSync(join(dir, "tsconfig.json"), config);
    const report = check({ projectDir: dir });
    expect(report.ok).toBe(false);
    if (!report.ok) expect(report.error).toMatch(/— fix:/);
  });

  it("supports absolute config paths, excludes declarations and imported files outside the project, and applies include filters", () => {
    const dir = project();
    const external = mkdtempSync(join(tmpdir(), "ttc-external-"));
    dirs.push(external);
    writeFileSync(join(external, "outside.ts"), "export const outside = 1;");
    writeFileSync(join(dir, "src/a.ts"), `import { outside } from ${JSON.stringify(join(external, "outside.ts"))}; export const a = outside;`);
    writeFileSync(join(dir, "src/types.d.ts"), "export declare const declared: number;");
    const configPath = join(dir, "tsconfig.app.json");
    writeFileSync(configPath, JSON.stringify({ compilerOptions: { noLib: true }, include: ["src"] }));
    const loaded = loadProgram(dir, { ...defaultConfig, include: ["src/a.ts"] }, configPath);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.files.map((file) => file.fileName)).toEqual([join(dir, "src/a.ts")]);
  });

  it("surfaces malformed checker configuration before loading a program", () => {
    const dir = project();
    writeFileSync(join(dir, "two-track-check.json"), "null");
    const report = check({ projectDir: dir });
    expect(report).toMatchObject({ ok: false, error: expect.stringContaining("expected an object — fix:") });
  });
});
