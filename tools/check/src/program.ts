/**
 * Builds the TypeScript program for a project directory and selects the files to check.
 */
import { existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import ts from "typescript";
import type { Config } from "./config.ts";
import { matchesAny } from "./config.ts";

export type ProgramLoad =
  | { readonly ok: true; readonly program: ts.Program; readonly files: ReadonlyArray<ts.SourceFile>; readonly configPath: string }
  | { readonly ok: false; readonly error: string };

const toPosix = (p: string): string => p.split("\\").join("/");

export const relPath = (projectDir: string, fileName: string): string => toPosix(relative(projectDir, fileName));

export const loadProgram = (projectDir: string, config: Config, projectOption?: string): ProgramLoad => {
  const configPath = projectOption === undefined ? join(projectDir, "tsconfig.json") : isAbsolute(projectOption) ? projectOption : resolve(projectDir, projectOption);
  if (!existsSync(configPath)) return { ok: false, error: `${configPath}: tsconfig not found — fix: run inside a TypeScript project or pass --project <path>` };
  const diagnostics: string[] = [];
  const host: ts.ParseConfigFileHost = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => diagnostics.push(ts.flattenDiagnosticMessageText(d.messageText, "\n")),
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, host);
  for (const diagnostic of parsed?.errors ?? []) diagnostics.push(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  if (parsed === undefined || diagnostics.length > 0) return { ok: false, error: `${configPath}: ${diagnostics.join("; ") || "could not parse"} — fix: make the tsconfig valid for TypeScript 6` };
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: { ...parsed.options, noEmit: true } });
  const projectAbs = resolve(projectDir);
  const files = program.getSourceFiles().filter((sf) => {
    if (sf.isDeclarationFile) return false;
    const abs = resolve(sf.fileName);
    if (!abs.startsWith(projectAbs + "/") && abs !== projectAbs) return false;
    if (abs.includes("/node_modules/")) return false;
    const rel = relPath(projectDir, sf.fileName);
    return config.include.length === 0 || matchesAny(rel, config.include);
  });
  return { ok: true, program, files, configPath };
};
