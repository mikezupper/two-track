/**
 * The rules. Each finding carries the fix, because the reader is usually an
 * agent that will apply it without further context.
 *
 * Detection is AST + type checker; comments are the only thing scanned as text.
 */
import { dirname, resolve } from "node:path";
import ts from "typescript";
import type { Config, LayerName } from "./config.ts";
import { layerOf, matchesAny } from "./config.ts";
import { relPath } from "./program.ts";

export type Severity = "error" | "review";

export type Finding = {
  readonly file: string;
  readonly line: number;
  readonly col: number;
  readonly rule: string;
  readonly severity: Severity;
  readonly message: string;
  readonly fix: string;
};

type Ctx = {
  readonly checker: ts.TypeChecker;
  readonly sf: ts.SourceFile;
  readonly rel: string;
  readonly layer: LayerName | undefined;
  readonly isTest: boolean;
  readonly isBrandFile: boolean;
  readonly projectDir: string;
  readonly config: Config;
  readonly twoTrackBindings: ReadonlyMap<string, string>; // local name -> imported name ("*" for namespace)
  readonly out: Finding[];
};

const report = (ctx: Ctx, node: ts.Node, rule: string, severity: Severity, message: string, fix: string): void => {
  const { line, character } = ctx.sf.getLineAndCharacterOfPosition(node.getStart(ctx.sf));
  ctx.out.push({ file: ctx.rel, line: line + 1, col: character + 1, rule, severity, message, fix });
};

const inLayer = (ctx: Ctx, ...layers: LayerName[]): boolean => ctx.layer !== undefined && layers.includes(ctx.layer);

// ---------- type helpers ----------

const isBooleanLiteralType = (t: ts.Type): boolean => (t.flags & ts.TypeFlags.BooleanLiteral) !== 0;

const hasLiteralOk = (checker: ts.TypeChecker, t: ts.Type): boolean => {
  const ok = t.getProperty("ok");
  if (ok === undefined) return false;
  const okType = checker.getTypeOfSymbol(ok);
  return isBooleanLiteralType(okType) || (okType.isUnion() && okType.types.every(isBooleanLiteralType) && okType.types.length === 1);
};

/** Structural detection of two-track's Result: {ok:true,value}|{ok:false,error} or either half alone. */
export const isResultType = (checker: ts.TypeChecker, type: ts.Type): boolean => {
  const t = checker.getApparentType(type);
  if (t.isUnion()) return t.types.length >= 2 && t.types.every((m) => hasLiteralOk(checker, m) && (m.getProperty("value") !== undefined || m.getProperty("error") !== undefined));
  return hasLiteralOk(checker, t) && (t.getProperty("value") !== undefined || t.getProperty("error") !== undefined);
};

const isPromiseType = (checker: ts.TypeChecker, type: ts.Type): boolean => {
  const t = checker.getApparentType(type);
  const name = t.getSymbol()?.getName();
  if (name === "Promise") return true;
  return t.getProperty("then") !== undefined && t.getProperty("catch") !== undefined;
};

/** Element type of an array/tuple/ReadonlyArray type, if any. */
const arrayElementType = (checker: ts.TypeChecker, type: ts.Type): ts.Type | undefined => {
  // A tuple's numeric index type includes every element, not just the first.
  return checker.getIndexTypeOfType(type, ts.IndexKind.Number);
};

/** Resolved type of a Promise<T>, if the type is a promise. */
const promisedType = (checker: ts.TypeChecker, type: ts.Type): ts.Type | undefined => {
  if (!isPromiseType(checker, type)) return undefined;
  const args = checker.getTypeArguments(checker.getApparentType(type) as ts.TypeReference);
  return args.length > 0 ? args[0] : undefined;
};

/**
 * Does a value of this type carry a Result anyone must inspect?
 * Result | Array<Result> | Promise<Result> | Promise<Array<Result>> | unions of those.
 * The blind spot this closes: `items.map(fallible)` produces Results nobody reads.
 */
export const containsResult = (checker: ts.TypeChecker, type: ts.Type, depth = 0): boolean => {
  if (depth > 3) return false;
  if (isResultType(checker, type)) return true;
  if (type.isUnion() && !isResultType(checker, type)) return type.types.some((m) => containsResult(checker, m, depth + 1));
  const promised = promisedType(checker, type);
  if (promised !== undefined) return containsResult(checker, promised, depth + 1);
  const element = arrayElementType(checker, checker.getApparentType(type));
  return element !== undefined && containsResult(checker, element, depth + 1);
};

const isVoidLike = (type: ts.Type): boolean =>
  (type.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) !== 0 || (type.isUnion() && type.types.some((m) => (m.flags & ts.TypeFlags.Void) !== 0));

/** A function type whose every call signature returns void (e.g. Array.prototype.forEach's callback). */
const expectsVoidCallback = (type: ts.Type | undefined): boolean =>
  type !== undefined && type.getCallSignatures().length > 0 && type.getCallSignatures().every((sig) => isVoidLike(sig.getReturnType()));

const callbackReturnType = (type: ts.Type): ts.Type | undefined => {
  const sigs = type.getCallSignatures();
  return sigs.length > 0 ? sigs[0]?.getReturnType() : undefined;
};

const isBrandedType = (checker: ts.TypeChecker, type: ts.Type, depth = 0): boolean => {
  if (depth > 4) return false;
  if (type.isUnionOrIntersection()) return type.types.some((m) => isBrandedType(checker, m, depth + 1));
  const apparent = checker.getApparentType(type);
  if (apparent !== type && apparent.isUnionOrIntersection()) return apparent.types.some((m) => isBrandedType(checker, m, depth + 1));
  return apparent.getProperties().some((p) => p.escapedName.toString().startsWith("__@BrandTag"));
};

// ---------- import bindings ----------

const collectTwoTrackBindings = (sf: ts.SourceFile): ReadonlyMap<string, string> => {
  const map = new Map<string, string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const spec = st.moduleSpecifier.text;
    if (spec !== "two-track" && !spec.startsWith("two-track/")) continue;
    const clause = st.importClause;
    if (clause === undefined) continue;
    if (clause.name !== undefined) map.set(clause.name.text, "default");
    const bindings = clause.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) map.set(bindings.name.text, spec === "two-track/decode" ? "D" : "*");
    else for (const el of bindings.elements) map.set(el.name.text, (el.propertyName ?? el.name).text);
  }
  return map;
};

/** The root identifier of a property-access chain, if any. */
const rootIdentifier = (expr: ts.Expression): ts.Identifier | undefined => {
  let cur: ts.Expression = expr;
  while (ts.isPropertyAccessExpression(cur)) cur = cur.expression;
  return ts.isIdentifier(cur) ? cur : undefined;
};

const calleeIs = (expr: ts.Expression, object: string, name: string): boolean =>
  ts.isPropertyAccessExpression(expr) && expr.name.text === name && ts.isIdentifier(expr.expression) && expr.expression.text === object;

const containsCallTo = (node: ts.Node, name: string): boolean => {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if ((ts.isIdentifier(callee) && callee.text === name) || (ts.isPropertyAccessExpression(callee) && callee.name.text === name)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
};

const enclosingFunctionNamed = (node: ts.Node, name: string): boolean => {
  let cur: ts.Node | undefined = node.parent;
  while (cur !== undefined) {
    if (ts.isFunctionDeclaration(cur) && cur.name?.text === name) return true;
    if (ts.isVariableDeclaration(cur) && ts.isIdentifier(cur.name) && cur.name.text === name) return true;
    cur = cur.parent;
  }
  return false;
};

// ---------- the visitor ----------

const checkNode = (ctx: Ctx, node: ts.Node): void => {
  const { checker } = ctx;

  if (ts.isThrowStatement(node) && !enclosingFunctionNamed(node, "assertNever")) {
    report(ctx, node, "no-throw", "error", "`throw` in application code", "return err(TaggedError({ ... })) on the error track; assertNever is the one sanctioned defect");
  }

  if (ts.isTryStatement(node)) {
    report(ctx, node, "no-try", "error", "`try` in application code", "wrap the throwing call once at the interop edge with R.fromThrowable (sync) or Async.tryPromise (async) in infra/");
  }

  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
    report(ctx, node, "no-class", "error", "class used for data or behaviour", "model data as a plain readonly object with a discriminant and put behaviour in functions (decision 0001)");
  }

  if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) && node.asteriskToken !== undefined) {
    const isAsync = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) === true;
    const streamAdapterAllowed = isAsync && inLayer(ctx, "infra", "lib");
    if (!streamAdapterAllowed) {
      report(ctx, node, "no-generators", "error", "generator function", "generators cost 40–80x on the railway (decision 0002); sequence with early returns or await + Async.andThen. The one allowed form is an async function* stream adapter in infra/ or lib/");
    }
  }

  if (node.kind === ts.SyntaxKind.AnyKeyword) {
    report(ctx, node, "no-any", "error", "`any` type", "use `unknown` and decode it with D.*, or a precise type");
  }

  if (ts.isNonNullExpression(node)) {
    report(ctx, node, "no-non-null", "error", "non-null assertion `!`", "narrow with a check, use Option, or decode at the boundary; `!` is an unproven claim");
  }

  if (ts.isCallExpression(node)) {
    const callee = node.expression;

    if (ts.isPropertyAccessExpression(callee) && callee.name.text === "catch" && isPromiseType(checker, checker.getTypeAtLocation(callee.expression))) {
      report(ctx, node, "no-catch", "error", "`.catch()` on a promise", "a railway promise never rejects: convert once with Async.fromPromise(promise, onReject) or Async.tryPromise at the interop edge");
    }

    if (calleeIs(callee, "Object", "freeze") && !ctx.isTest) {
      report(ctx, node, "no-freeze", "error", "`Object.freeze` at runtime", "immutability is a compile-time property here (decision 0003, 10–20x measured): use readonly types; freeze fixtures only in tests");
    }

    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "Promise" && ["all", "allSettled", "race", "any"].includes(callee.name.text) && !inLayer(ctx, "lib") && !ctx.isTest) {
      report(ctx, node, "no-bare-promise-all", "error", `\`Promise.${callee.name.text}\` fan-out`, "use Async.mapConcurrent / Async.validateConcurrent (bounded, AbortSignal-aware) or Async.withTimeout for races");
    }

    // A callback handed to a void-returning parameter (forEach, event listeners, ...) has its return value
    // thrown away by the callee. If that return is a Result (or a Promise), the error vanishes just as
    // surely as with an ignored expression statement — the `forEach` blind spot.
    for (const arg of node.arguments) {
      if (ts.isSpreadElement(arg)) continue;
      const contextual = checker.getContextualType(arg);
      if (!expectsVoidCallback(contextual)) continue;
      const returned = callbackReturnType(checker.getTypeAtLocation(arg));
      if (returned === undefined) continue;
      if (isPromiseType(checker, returned)) {
        report(ctx, arg, "floating-async-callback", "error", "async callback in a void context (e.g. forEach) — its promise is dropped, so nothing awaits it and its failure is lost", "use `for (const x of xs) { const r = await f(x); if (!r.ok) return r; }` or Async.mapConcurrent");
      } else if (containsResult(checker, returned)) {
        report(ctx, arg, "ignored-result-in-callback", "error", "callback returns a Result into a void context (e.g. forEach) — the caller discards it and the error vanishes", "use R.traverse / R.validateAll / Async.mapConcurrent, or a for-of loop with `if (!r.ok) return r;`");
      }
    }

    if (ts.isIdentifier(callee) && callee.text === "fetch") {
      const second = node.arguments[1];
      if (second === undefined) report(ctx, node, "fetch-needs-signal", "error", "`fetch` without an AbortSignal", "pass the signal you were handed: fetch(url, { signal })");
      else if (ts.isObjectLiteralExpression(second)) {
        const hasSignal = second.properties.some((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && ts.isIdentifier(p.name) && p.name.text === "signal");
        const hasSpread = second.properties.some((p) => ts.isSpreadAssignment(p));
        if (!hasSignal && !hasSpread) report(ctx, node, "fetch-needs-signal", "error", "`fetch` options without `signal`", "add the AbortSignal you were handed to the options: { ...init, signal }");
        else if (!hasSignal) report(ctx, node, "fetch-needs-signal", "review", "`fetch` options are spread; cannot see a `signal`", "make sure the spread object carries the AbortSignal");
      } else report(ctx, node, "fetch-needs-signal", "review", "`fetch` options are not a literal; cannot see a `signal`", "make sure the options object carries the AbortSignal you were handed");
    }

    const platformExempt = inLayer(ctx, "infra", "lib", "root") || ctx.isTest;
    if (!platformExempt) {
      if (calleeIs(callee, "Date", "now")) report(ctx, node, "no-platform-calls", "error", "`Date.now()` outside infra/", "take a Cap.Clock capability (deps.clock.now()) so the domain stays pure and testable");
      else if (calleeIs(callee, "Math", "random")) report(ctx, node, "no-platform-calls", "error", "`Math.random()` outside infra/", "take a Cap.Random capability (deps.random.next())");
      else if (ts.isPropertyAccessExpression(callee) && callee.name.text === "randomUUID") report(ctx, node, "no-platform-calls", "error", "`randomUUID()` outside infra/", "take a Cap.IdGen capability (deps.ids.next())");
      else if (ts.isIdentifier(callee) && (callee.text === "setTimeout" || callee.text === "setInterval")) report(ctx, node, "no-platform-calls", "error", `\`${callee.text}\` outside infra/`, "take a Cap.Sleeper capability, or use Async.retry/withTimeout/Lane helpers which do");
      else if (ts.isIdentifier(callee) && callee.text === "fetch") report(ctx, node, "no-platform-calls", "error", "`fetch` outside infra/", "put the HTTP call behind a port interface implemented in infra/ with Async.tryPromise");
    }

    // review-only hatches
    if (ts.isPropertyAccessExpression(callee) && callee.name.text === "unwrapOr") {
      const root = rootIdentifier(callee.expression);
      if (root !== undefined && ctx.twoTrackBindings.has(root.text)) report(ctx, node, "review-unwrap-or", "review", "`unwrapOr` swallows the error", "confirm the fallback is correct by design (not a way to silence the type); prefer match/unwrapOrElse when the error matters");
    } else if (ts.isIdentifier(callee) && ctx.twoTrackBindings.get(callee.text) === "unwrapOr") {
      report(ctx, node, "review-unwrap-or", "review", "`unwrapOr` swallows the error", "confirm the fallback is correct by design (not a way to silence the type); prefer match/unwrapOrElse when the error matters");
    }
  }

  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Date" && (node.arguments === undefined || node.arguments.length === 0) && !inLayer(ctx, "infra", "lib", "root") && !ctx.isTest) {
    report(ctx, node, "no-platform-calls", "error", "`new Date()` outside infra/", "take a Cap.Clock capability and construct from deps.clock.now()");
  }

  if (ts.isPropertyAccessExpression(node)) {
    if (ts.isIdentifier(node.expression) && node.expression.text === "console" && !inLayer(ctx, "infra", "lib", "root") && !ctx.isTest) {
      report(ctx, node, "no-console", "error", "`console.*` outside infra/", "log through a Logger port at the edge; the domain returns information on the error track");
    }
    if (node.name.text === "unknown" && ts.isIdentifier(node.expression)) {
      const bound = ctx.twoTrackBindings.get(node.expression.text);
      if (bound === "D" || (bound === "*" && node.expression.text === "D")) report(ctx, node, "review-decode-unknown", "review", "`D.unknown` lets untyped data into the domain", "decode the actual shape; if the value is genuinely opaque, name it with a brand and never read into it");
    } else if (node.name.text === "unknown" && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "D") {
      const root = rootIdentifier(node.expression);
      if (root !== undefined && ctx.twoTrackBindings.get(root.text) === "*") report(ctx, node, "review-decode-unknown", "review", "`D.unknown` lets untyped data into the domain", "decode the actual shape; if the value is genuinely opaque, name it with a brand and never read into it");
    }
  }

  if (ts.isIdentifier(node) && !ts.isImportSpecifier(node.parent) && ctx.twoTrackBindings.get(node.text) === "unknown") {
    report(ctx, node, "review-decode-unknown", "review", "`D.unknown` lets untyped data into the domain", "decode the actual shape; if the value is genuinely opaque, name it with a brand and never read into it");
  }

  if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && !ctx.isBrandFile && !ctx.isTest) {
    const isUnknownChain = ts.isAsExpression(node) && ts.isAsExpression(node.expression) && node.expression.type.kind === ts.SyntaxKind.UnknownKeyword;
    const typeText = node.type.getText(ctx.sf);
    const target = checker.getTypeFromTypeNode(node.type);
    if (isUnknownChain || typeText.startsWith("Brand<") || isBrandedType(checker, target)) {
      report(ctx, node, "no-brand-cast", "error", isUnknownChain ? "`as unknown as` forges a type" : `cast to branded type \`${typeText}\``, "brands come from D.brand inside a decoder; re-brand arithmetic through ONE helper in a brandFiles module (decoders.ts / brands.ts)");
    }
  }

  if (ts.isDefaultClause(node) && !node.statements.some((s) => containsCallTo(s, "assertNever"))) {
    report(ctx, node, "switch-default-without-assert-never", "error", "`default:` without assertNever absorbs future variants silently", "use match()/matchBy(), or make it `default: return assertNever(x)` so a new variant fails to compile");
  }

  if (ts.isExpressionStatement(node)) {
    const expr = node.expression;
    // Judge the statement by its TYPE, not its syntax: `await p;` or a bare `r;` where the
    // value is a Result drops the error just as surely as an ignored call. Only expressions
    // that exist for their effect are exempt (assignment, void, delete, ++/--, yield).
    const inner = ts.isAwaitExpression(expr) ? expr.expression : expr;
    const effectOnly =
      ts.isVoidExpression(expr) ||
      ts.isDeleteExpression(inner) ||
      ts.isPrefixUnaryExpression(inner) ||
      ts.isPostfixUnaryExpression(inner) ||
      ts.isYieldExpression(inner) ||
      (ts.isBinaryExpression(inner) && inner.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && inner.operatorToken.kind <= ts.SyntaxKind.LastAssignment);
    if (!effectOnly) {
      const type = checker.getTypeAtLocation(expr);
      const isCall = ts.isCallExpression(inner) || ts.isNewExpression(inner);
      const what = isCall ? "" : " (a value, not a call — it was computed earlier and never inspected)";
      if (isResultType(checker, type)) {
        report(ctx, node, "ignored-result", "error", `Result ignored${what} — the error silently vanishes`, "handle it: `const r = ...; if (!r.ok) return r;` or discard explicitly with `void` and a reason comment");
      } else if (!isPromiseType(checker, type) && containsResult(checker, type)) {
        report(ctx, node, "ignored-result", "error", `a collection of Results ignored${what} — \`map\` over a fallible function produced Results nobody inspects`, "use R.traverse (first error) or R.validateAll (all errors) and handle the Result, or discard explicitly with `void` and a reason comment");
      } else if (!ts.isAwaitExpression(expr) && isPromiseType(checker, type)) {
        report(ctx, node, "floating-async-result", "error", `promise not awaited${what} — its outcome (and any error) is lost`, "await it and handle the Result, return it, or discard explicitly with `void` and a reason comment");
      }
    }
  }

  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
    checkImport(ctx, node, node.moduleSpecifier.text);
  }

  ts.forEachChild(node, (child) => checkNode(ctx, child));
};

const resolveRelative = (ctx: Ctx, spec: string): string => relPath(ctx.projectDir, resolve(dirname(ctx.sf.fileName), spec));

const checkImport = (ctx: Ctx, node: ts.Node, spec: string): void => {
  const isRelative = spec.startsWith("./") || spec.startsWith("../");
  if (ctx.layer === "domain") {
    if (isRelative) {
      const target = resolveRelative(ctx, spec);
      if (!matchesAny(target, ctx.config.layers.domain)) report(ctx, node, "layer-domain-imports", "error", `domain imports ${spec}, which resolves outside domain/`, "the domain depends on nothing but two-track and itself; move the shared piece into domain/ or invert the dependency");
    } else if (!ctx.config.allowedDomainImports.some((a) => spec === a || spec.startsWith(`${a}/`))) {
      report(ctx, node, "layer-domain-imports", "error", `domain imports "${spec}"`, `domain/ may import only [${ctx.config.allowedDomainImports.join(", ")}]; drivers and frameworks belong in infra/, injected through ports`);
    }
  } else if (ctx.layer === "workflows") {
    if (isRelative) {
      const target = resolveRelative(ctx, spec);
      if (matchesAny(target, ctx.config.layers.infra)) report(ctx, node, "layer-workflows-imports", "error", `workflow imports ${spec} from infra/`, "workflows see infrastructure only through port interfaces on the deps record; wire the implementation in main.ts");
    } else if (spec.startsWith("node:")) {
      report(ctx, node, "layer-workflows-imports", "error", `workflow imports "${spec}"`, "platform modules belong in infra/ behind a port");
    } else if (spec !== "two-track" && !spec.startsWith("two-track/")) {
      report(ctx, node, "layer-workflows-imports", "error", `workflow imports "${spec}"`, "drivers and frameworks belong in infra/; workflows take them as ports on the deps record");
    }
  }
};

const collectComments = (sf: ts.SourceFile): ReadonlyArray<ts.CommentRange> => {
  const ranges = new Map<number, ts.CommentRange>();
  const visit = (node: ts.Node): void => {
    for (const range of ts.getLeadingCommentRanges(sf.text, node.getFullStart()) ?? []) ranges.set(range.pos, range);
    for (const range of ts.getTrailingCommentRanges(sf.text, node.end) ?? []) ranges.set(range.pos, range);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...ranges.values()];
};

const scanComments = (ctx: Ctx, comments: ReadonlyArray<ts.CommentRange>): void => {
  if (ctx.isTest) return;
  const re = /@ts-(ignore|expect-error|nocheck)\b/g;
  for (const comment of comments) {
    for (const m of ctx.sf.text.slice(comment.pos, comment.end).matchAll(re)) {
      const pos = comment.pos + m.index;
      const { line, character } = ctx.sf.getLineAndCharacterOfPosition(pos);
      ctx.out.push({ file: ctx.rel, line: line + 1, col: character + 1, rule: "no-ts-suppress", severity: "error", message: `\`@ts-${m[1]}\` hides a type error`, fix: "fix the type error; the compiler's proof is the point" });
    }
  }
};

const ALLOW_RE = /two-track-check-allow\s+([a-z-]+)(?:\s+(.*))?/;

/** Apply `// two-track-check-allow <rule> <reason>` suppressions on the same or preceding line. */
const applySuppressions = (sf: ts.SourceFile, rel: string, findings: ReadonlyArray<Finding>, comments: ReadonlyArray<ts.CommentRange>): { readonly kept: Finding[]; readonly allowed: number } => {
  const lines = new Map<number, string>();
  for (const comment of comments) {
    const first = sf.getLineAndCharacterOfPosition(comment.pos).line;
    sf.text.slice(comment.pos, comment.end).split("\n").forEach((line, index) => {
      const number = first + index + 1;
      lines.set(number, `${lines.get(number) ?? ""} ${line}`);
    });
  }
  const kept: Finding[] = [];
  let allowed = 0;
  const seenBadAllow = new Set<number>();
  for (const f of findings) {
    let suppressed = false;
    for (const ln of [f.line, f.line - 1]) {
      const textLine = lines.get(ln);
      if (textLine === undefined) continue;
      const m = ALLOW_RE.exec(textLine);
      if (m === null || m[1] !== f.rule) continue;
      const reason = (m[2] ?? "").trim();
      if (reason === "") {
        if (!seenBadAllow.has(ln)) {
          seenBadAllow.add(ln);
          kept.push({ file: rel, line: f.line, col: f.col, rule: "allow-needs-reason", severity: "error", message: `suppression of ${f.rule} has no reason`, fix: "write why this line is an exception: // two-track-check-allow <rule> <reason>" });
        }
        continue;
      }
      suppressed = true;
      break;
    }
    if (suppressed) allowed++;
    else kept.push(f);
  }
  return { kept, allowed };
};

export type FileResult = { readonly findings: ReadonlyArray<Finding>; readonly allowed: number };

export const checkSourceFile = (program: ts.Program, sf: ts.SourceFile, projectDir: string, config: Config): FileResult => {
  const rel = relPath(projectDir, sf.fileName);
  const ctx: Ctx = {
    checker: program.getTypeChecker(),
    sf,
    rel,
    layer: layerOf(rel, config),
    isTest: matchesAny(rel, config.testFiles),
    isBrandFile: matchesAny(rel, config.brandFiles),
    projectDir,
    config,
    twoTrackBindings: collectTwoTrackBindings(sf),
    out: [],
  };
  const comments = collectComments(sf);
  checkNode(ctx, sf);
  scanComments(ctx, comments);
  const { kept, allowed } = applySuppressions(sf, rel, ctx.out, comments);
  kept.sort((a, b) => a.line - b.line || a.col - b.col || a.rule.localeCompare(b.rule));
  return { findings: kept, allowed };
};
