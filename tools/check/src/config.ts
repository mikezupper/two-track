/**
 * Configuration: which directories form which layer, where brands may be cast,
 * which files are tests. Every key has a default that matches the layout the
 * two-track-fp-skill scaffolds (src/domain, src/workflows, src/infra, src/lib, src/main.ts).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type LayerName = "domain" | "workflows" | "infra" | "lib" | "root";

export type Config = {
  readonly layers: Readonly<Record<LayerName, ReadonlyArray<string>>>;
  readonly brandFiles: ReadonlyArray<string>;
  readonly allowedDomainImports: ReadonlyArray<string>;
  readonly testFiles: ReadonlyArray<string>;
  /** Optional: only check files matching these globs (relative to the project dir). */
  readonly include: ReadonlyArray<string>;
};

export const defaultConfig: Config = {
  layers: {
    domain: ["src/domain"],
    workflows: ["src/workflows"],
    infra: ["src/infra"],
    lib: ["src/lib"],
    root: ["src/main.ts"],
  },
  brandFiles: ["**/decoders.ts", "**/brands.ts", "**/domain/types.ts"],
  allowedDomainImports: ["two-track"],
  testFiles: ["**/*.test.ts", "test/**"],
  include: [],
};

export type ConfigLoad =
  | { readonly ok: true; readonly config: Config; readonly source: string }
  | { readonly ok: false; readonly error: string };

const isStringArray = (value: unknown): value is ReadonlyArray<string> =>
  Array.isArray(value) && value.every((v) => typeof v === "string");

const parseJson = (text: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly message: string } => {
  // two-track-check-allow no-try JSON.parse is the one interop edge of this package
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (thrown) {
    return { ok: false, message: thrown instanceof Error ? thrown.message : String(thrown) };
  }
};

/** Load `two-track-check.json` from the project dir, merging over the defaults. Missing file = defaults. */
export const loadConfig = (projectDir: string): ConfigLoad => {
  const file = join(projectDir, "two-track-check.json");
  if (!existsSync(file)) return { ok: true, config: defaultConfig, source: "defaults" };
  const parsed = parseJson(readFileSync(file, "utf8"));
  if (!parsed.ok) return { ok: false, error: `${file}: invalid JSON (${parsed.message}) — fix: correct the file or delete it to use the defaults` };
  const raw = parsed.value;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, error: `${file}: expected an object — fix: see the config schema in the README` };
  const obj = raw as Record<string, unknown>;
  const layersRaw = obj["layers"];
  const layers: Record<LayerName, ReadonlyArray<string>> = { ...defaultConfig.layers };
  if (layersRaw !== undefined) {
    if (typeof layersRaw !== "object" || layersRaw === null || Array.isArray(layersRaw)) return { ok: false, error: `${file}: "layers" must be an object of string arrays — fix: {"domain":["src/domain"],...}` };
    for (const name of ["domain", "workflows", "infra", "lib", "root"] as const) {
      const v = (layersRaw as Record<string, unknown>)[name];
      if (v === undefined) continue;
      if (!isStringArray(v)) return { ok: false, error: `${file}: "layers.${name}" must be a string array — fix: list directories or files relative to the project dir` };
      layers[name] = v;
    }
  }
  const arrays: Record<"brandFiles" | "allowedDomainImports" | "testFiles" | "include", ReadonlyArray<string>> = {
    brandFiles: defaultConfig.brandFiles,
    allowedDomainImports: defaultConfig.allowedDomainImports,
    testFiles: defaultConfig.testFiles,
    include: defaultConfig.include,
  };
  for (const key of ["brandFiles", "allowedDomainImports", "testFiles", "include"] as const) {
    const v = obj[key];
    if (v === undefined) continue;
    if (!isStringArray(v)) return { ok: false, error: `${file}: "${key}" must be a string array — fix: see the config schema in the README` };
    arrays[key] = v;
  }
  return { ok: true, config: { layers, ...arrays }, source: file };
};

/**
 * Minimal glob matching with no dependency: `**` matches across directories,
 * `*` within one segment. A pattern with no glob characters is a path prefix
 * (a directory or an exact file).
 */
export const globToRegExp = (pattern: string): RegExp => {
  let out = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i] as string;
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        const slashAfter = pattern[i + 2] === "/";
        out += slashAfter ? "(?:.*/)?" : ".*";
        i += slashAfter ? 2 : 1;
      } else out += "[^/]*";
    } else if (ch === "?") out += "[^/]";
    else if (".+^${}()|[]\\".includes(ch)) out += `\\${ch}`;
    else out += ch;
  }
  return new RegExp(`${out}$`);
};

export const matchesAny = (relPath: string, patterns: ReadonlyArray<string>): boolean => {
  for (const p of patterns) {
    const normalized = p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
    if (normalized === "") continue;
    if (/[*?]/.test(normalized)) {
      if (globToRegExp(normalized).test(relPath)) return true;
    } else if (relPath === normalized || relPath.startsWith(`${normalized}/`)) return true;
  }
  return false;
};

export const layerOf = (relPath: string, config: Config): LayerName | undefined => {
  for (const name of ["root", "domain", "workflows", "infra", "lib"] as const) {
    if (matchesAny(relPath, config.layers[name])) return name;
  }
  return undefined;
};
