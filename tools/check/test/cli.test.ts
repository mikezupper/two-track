import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.ts";
import { check, formatFinding, type Finding, type Report } from "../src/index.ts";

vi.mock("../src/index.ts", () => ({ check: vi.fn(), formatFinding: vi.fn() }));
const finding: Finding = { file: "src/main.ts", line: 1, col: 1, rule: "review-unwrap-or", severity: "review", message: "fallback", fix: "handle the failure" };
const clean: Report = { ok: true, findings: [], summary: { files: 2, errors: 0, reviews: 0, allowed: 0 }, configSource: "defaults" };

beforeEach(() => {
  vi.mocked(check).mockReturnValue(clean);
  vi.mocked(formatFinding).mockReturnValue("formatted finding");
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.mocked(check).mockClear(); });

describe("CLI contract", () => {
  it.each(["--help", "-h"])("%s prints usage without loading a project", (flag) => {
    expect(main([flag])).toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("usage:"));
    expect(check).not.toHaveBeenCalled();
  });

  it.each([["--unknown"], ["--project"], ["--project", "--json"], ["first", "second"]])("rejects invalid arguments %j", (...argv) => {
    expect(main(argv)).toBe(2);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("usage:"));
    expect(check).not.toHaveBeenCalled();
  });

  it("uses the current directory and reports a clean summary", () => {
    expect(main([])).toBe(0);
    expect(check).toHaveBeenCalledWith({ projectDir: "." });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("2 file(s), 0 error(s)"));
  });

  it("passes the project directory and explicit tsconfig", () => {
    expect(main(["--project", "tsconfig.app.json", "app"])).toBe(0);
    expect(check).toHaveBeenCalledWith({ projectDir: "app", project: "tsconfig.app.json" });
  });

  it("configuration errors exit 2 with the diagnostic", () => {
    vi.mocked(check).mockReturnValue({ ok: false, error: "invalid config — fix: correct it" });
    expect(main([])).toBe(2);
    expect(console.error).toHaveBeenCalledWith("invalid config — fix: correct it");
  });

  it("JSON output includes findings, counts, and config source", () => {
    expect(main(["--json"])).toBe(0);
    expect(JSON.parse(vi.mocked(console.log).mock.calls[0]?.[0] as string)).toEqual({ findings: [], summary: clean.summary, configSource: "defaults" });
  });

  it("review findings pass normally and fail with --strict", () => {
    vi.mocked(check).mockReturnValue({ ...clean, findings: [finding], summary: { files: 1, errors: 0, reviews: 1, allowed: 0 } });
    expect(main([])).toBe(0);
    expect(formatFinding).toHaveBeenCalledWith(finding);
    expect(console.log).toHaveBeenCalledWith("formatted finding");
    expect(main(["--strict", "--json"])).toBe(1);
  });

  it("error findings fail even without --strict", () => {
    vi.mocked(check).mockReturnValue({ ...clean, findings: [{ ...finding, severity: "error" }], summary: { files: 1, errors: 1, reviews: 0, allowed: 0 } });
    expect(main([])).toBe(1);
    expect(main(["--json"])).toBe(1);
  });
});
