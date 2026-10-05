import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig, globToRegExp, layerOf, loadConfig, matchesAny } from "../src/config.ts";

describe("glob matching", () => {
  it("handles **, *, prefixes and exact files", () => {
    expect(globToRegExp("**/decoders.ts").test("src/domain/decoders.ts")).toBe(true);
    expect(globToRegExp("**/decoders.ts").test("decoders.ts")).toBe(true);
    expect(globToRegExp("src/*/x.ts").test("src/a/x.ts")).toBe(true);
    expect(globToRegExp("src/*/x.ts").test("src/a/b/x.ts")).toBe(false);
    expect(globToRegExp("test/**").test("test/a/b.ts")).toBe(true);
    expect(matchesAny("src/domain/a.ts", ["src/domain"])).toBe(true);
    expect(matchesAny("src/domainx/a.ts", ["src/domain"])).toBe(false);
    expect(matchesAny("src/main.ts", ["./src/main.ts"])).toBe(true);
    expect(matchesAny("a.test.ts", ["**/*.test.ts"])).toBe(true);
  });

  it("assigns layers, root first", () => {
    expect(layerOf("src/main.ts", defaultConfig)).toBe("root");
    expect(layerOf("src/domain/x.ts", defaultConfig)).toBe("domain");
    expect(layerOf("src/other/x.ts", defaultConfig)).toBeUndefined();
  });
});

describe("loadConfig", () => {
  it("defaults when absent, merges when present, rejects bad shapes with a fix", () => {
    const dir = mkdtempSync(join(tmpdir(), "ttc-"));
    expect(loadConfig(dir)).toMatchObject({ ok: true, source: "defaults" });
    writeFileSync(join(dir, "two-track-check.json"), JSON.stringify({ layers: { domain: ["lib/domain"] }, brandFiles: ["**/b.ts"] }));
    const merged = loadConfig(dir);
    expect(merged.ok && merged.config.layers.domain).toEqual(["lib/domain"]);
    expect(merged.ok && merged.config.layers.infra).toEqual(["src/infra"]);
    expect(merged.ok && merged.config.brandFiles).toEqual(["**/b.ts"]);
    writeFileSync(join(dir, "two-track-check.json"), "{ nope");
    expect(loadConfig(dir)).toMatchObject({ ok: false });
    writeFileSync(join(dir, "two-track-check.json"), JSON.stringify({ brandFiles: "x" }));
    const bad = loadConfig(dir);
    expect(!bad.ok && bad.error).toMatch(/— fix:/);
    writeFileSync(join(dir, "two-track-check.json"), JSON.stringify({ layers: { domain: "x" } }));
    expect(loadConfig(dir)).toMatchObject({ ok: false });
  });
});
