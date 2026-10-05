/**
 * two-track-check — programmatic API. The bin is a thin wrapper around `check`.
 */
import { isAbsolute, relative, resolve } from "node:path";
import { loadConfig, type Config } from "./config.ts";
import { loadProgram } from "./program.ts";
import { checkSourceFile, type Finding } from "./rules.ts";

export type { Config, LayerName } from "./config.ts";
export type { Finding, Severity } from "./rules.ts";
export { defaultConfig, loadConfig } from "./config.ts";

export type CheckOptions = {
  readonly projectDir: string;
  /** Path to a tsconfig; default `<projectDir>/tsconfig.json`. */
  readonly project?: string;
  /** Overrides the config file when given. */
  readonly config?: Config;
};

export type Summary = {
  readonly files: number;
  readonly errors: number;
  readonly reviews: number;
  readonly allowed: number;
};

export type Report =
  | { readonly ok: true; readonly findings: ReadonlyArray<Finding>; readonly summary: Summary; readonly configSource: string }
  | { readonly ok: false; readonly error: string };

export const check = (options: CheckOptions): Report => {
  const projectDir = resolve(options.projectDir);
  let config: Config;
  let configSource: string;
  if (options.config !== undefined) {
    config = options.config;
    configSource = "options";
  } else {
    const loaded = loadConfig(projectDir);
    if (!loaded.ok) return { ok: false, error: loaded.error };
    config = loaded.config;
    configSource = isAbsolute(loaded.source) ? relative(projectDir, loaded.source) || loaded.source : loaded.source;
  }
  const loaded = loadProgram(projectDir, config, options.project);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const findings: Finding[] = [];
  let allowed = 0;
  for (const sf of loaded.files) {
    const r = checkSourceFile(loaded.program, sf, projectDir, config);
    findings.push(...r.findings);
    allowed += r.allowed;
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.col - b.col || a.rule.localeCompare(b.rule));
  const errors = findings.filter((f) => f.severity === "error").length;
  return {
    ok: true,
    findings,
    summary: { files: loaded.files.length, errors, reviews: findings.length - errors, allowed },
    configSource,
  };
};

export const formatFinding = (f: Finding): string => `${f.file}:${f.line}:${f.col}: [${f.rule}] ${f.message} — fix: ${f.fix}`;
