import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkInvariants, formatViolations } from "../scripts/invariants.ts";

let root: string;
const write = (file: string, contents: string): void => {
  const full = join(root, file);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
};
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "two-track-invariants-"));
  write("package.json", "{}");
  write("src/result.ts", "export const ok = (value: unknown) => ({ ok: true, value });");
  write("docs/design-docs/index.md", "# Decisions");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("repository invariant enforcement", () => {
  it("accepts a compliant tree and skips generated directories", () => {
    write("src/dist/ignored.ts", "throw 1;");
    write("src/node_modules/ignored.ts", "throw 1;");
    write("src/coverage/ignored.ts", "throw 1;");
    write("src/.git/ignored.ts", "throw 1;");
    write("src/note.txt", "not source");
    expect(checkInvariants(root)).toEqual([]);
  });

  it.each([
    ["no-throw", "throw 1;"],
    ["no-try", "try { work(); }", "src/tagged.ts"],
    ["no-catch-method", "promise.catch(handle);"],
    ["no-any", "export const loose: any = 1;"],
    ["no-ts-suppression", "const x = 1; // @ts-ignore"],
    ["no-generators", "function* items() { yield 1; }"],
    ["no-freeze", "Object.freeze({});"],
    ["no-class", "class Order {}"],
    ["no-console", "console.log(1);"],
    ["no-platform-time", "Date.now();"],
    ["no-platform-random", "Math.random();"],
    ["no-platform-timers", "setTimeout(work, 1);"],
    ["no-node-imports", 'import { readFileSync } from "node:fs";'],
    ["no-unknown-cast", "const x = 1 as unknown as string;", "src/tagged.ts"],
    ["no-non-null-assertion", "const x = object!.value;"],
    ["no-let-for-mutation-escape", "export let changing = 1;"],
  ])("detects %s with a concrete fix", (rule, source, file = "src/result.ts") => {
    write(file, source);
    const violations = checkInvariants(root);
    expect(violations.map((v) => v.rule)).toContain(rule);
    expect(formatViolations(violations)).toContain("— fix:");
  });

  it("allows documented interop and capability edges and ignores discussion in comments", () => {
    write("src/result.ts", "// throw and Object.freeze are banned\n/**\n * class Order, console.log\n */\ntry { call(); }");
    write("src/match.ts", "throw new Error('unreachable');");
    write("src/capabilities.ts", "Date.now(); Math.random(); setTimeout(work, 1);");
    write("test/capabilities.properties.test.ts", "fc.assert(fc.property(arb, capability));");
    expect(checkInvariants(root)).toEqual([]);
  });

  it("rejects runtime and peer dependencies but permits development dependencies", () => {
    write("package.json", JSON.stringify({ dependencies: { runtime: "1" }, peerDependencies: { peer: "1" }, devDependencies: { development: "1" } }));
    const violations = checkInvariants(root);
    expect(violations).toHaveLength(2);
    expect(violations.every((v) => v.rule === "zero-runtime-deps")).toBe(true);
  });

  it("checks layer registration, direction and module size", () => {
    write("src/new.ts", "export const newModule = 1;");
    write("src/option.ts", 'import { retry } from "./async.ts";');
    write("src/brand.ts", "// line\n".repeat(401));
    expect(checkInvariants(root).map((v) => v.rule)).toEqual(expect.arrayContaining(["layer-registered", "layer-direction", "max-file-lines"]));
  });

  it("accepts permitted edges and the index surface", () => {
    write("src/option.ts", 'import { ok } from "./result.ts";');
    write("src/index.ts", 'export { ok } from "./result.ts";');
    expect(checkInvariants(root)).toEqual([]);
  });

  it("requires real property suites and mentions of every behavioral export", () => {
    write("src/async.ts", "export const run = () => 1;");
    expect(checkInvariants(root).map((v) => v.rule)).toContain("property-tests-exist");
    write("test/async.properties.test.ts", "run();");
    expect(checkInvariants(root).map((v) => v.rule)).toContain("property-tests-exist");
    write("test/async.properties.test.ts", "fc.assert(fc.property(input, unrelated));");
    expect(checkInvariants(root).map((v) => v.rule)).toContain("property-test-coverage");
    write("test/async.properties.test.ts", "fc.assert(fc.property(input, run));");
    expect(checkInvariants(root)).toEqual([]);
  });

  it("checks links, decision indexing and active plan structure", () => {
    write("docs/note.md", "[missing](missing.md) [self](note.md#anchor) [web](https://example.com)");
    write("docs/design-docs/decisions/0001-choice.md", "# Choice");
    write("docs/exec-plans/active/0001-plan.md", "## Progress");
    expect(checkInvariants(root).map((v) => v.rule)).toEqual(expect.arrayContaining(["doc-link-resolves", "decision-indexed", "plan-shape"]));
    write("docs/note.md", "[self](note.md#anchor)");
    write("docs/design-docs/index.md", "[choice](decisions/0001-choice.md)");
    write("docs/exec-plans/active/0001-plan.md", "## Progress\n## Decision log");
    expect(checkInvariants(root)).toEqual([]);
  });
});
