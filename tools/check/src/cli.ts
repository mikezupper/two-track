/**
 * CLI: two-track-check [--project <tsconfig>] [--json] [--strict] [project-dir]
 * Exit 1 on any error finding (and on review findings with --strict); 0 otherwise.
 */
import { check, formatFinding } from "./index.ts";

const USAGE = `usage: two-track-check [options] [project-dir]
  --project <path>   tsconfig to use (default: <project-dir>/tsconfig.json)
  --json             machine-readable output
  --strict           also fail on review findings
  --help             this text`;

type Args = { readonly projectDir: string; readonly project?: string; readonly json: boolean; readonly strict: boolean; readonly help: boolean; readonly error?: string };

const parseArgs = (argv: ReadonlyArray<string>): Args => {
  let projectDir = ".";
  let project: string | undefined;
  let json = false;
  let strict = false;
  let help = false;
  let hasProjectDir = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--json") json = true;
    else if (a === "--strict") strict = true;
    else if (a === "--help" || a === "-h") help = true;
    else if (a === "--project") {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) return { projectDir, json, strict, help, error: "--project needs a path" };
      project = v;
    } else if (a.startsWith("--")) return { projectDir, json, strict, help, error: `unknown option ${a}` };
    else {
      if (hasProjectDir) return { projectDir, json, strict, help, error: "only one project directory is allowed" };
      projectDir = a;
      hasProjectDir = true;
    }
  }
  return project === undefined ? { projectDir, json, strict, help } : { projectDir, project, json, strict, help };
};

export const main = (argv: ReadonlyArray<string>): number => {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (args.error !== undefined) {
    console.error(`${args.error}\n${USAGE}`);
    return 2;
  }
  const report = check(args.project === undefined ? { projectDir: args.projectDir } : { projectDir: args.projectDir, project: args.project });
  if (!report.ok) {
    console.error(report.error);
    return 2;
  }
  const failed = report.summary.errors > 0 || (args.strict && report.summary.reviews > 0);
  if (args.json) {
    console.log(JSON.stringify({ findings: report.findings, summary: report.summary, configSource: report.configSource }, null, 2));
    return failed ? 1 : 0;
  }
  for (const f of report.findings) console.log(formatFinding(f));
  const s = report.summary;
  console.log(`${report.findings.length === 0 ? "" : "\n"}two-track-check: ${s.files} file(s), ${s.errors} error(s), ${s.reviews} review item(s), ${s.allowed} allowed (config: ${report.configSource})`);
  return failed ? 1 : 0;
};
