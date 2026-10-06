# two-track-check

Static checker for applications built on [`two-track`](../../README.md). It finds the anti-FP foot-guns the TypeScript compiler cannot see, and every finding ends with the fix, because the reader is usually a coding agent that will apply it without further context.

```bash
pnpm add -D two-track-check
npx two-track-check            # checks the project in the current directory (tsconfig.json)
npx two-track-check --project tsconfig.app.json apps/api
npx two-track-check --json     # machine-readable
npx two-track-check --strict   # also fail on review items
```

Exit code: `1` if any error finding (or any review finding with `--strict`), `2` on a usage/config error, `0` otherwise.

Sample output:

```
src/workflows/checkout.ts:41:3: [ignored-result] Result ignored — the error silently vanishes — fix: handle it: `const r = ...; if (!r.ok) return r;` or discard explicitly with `void` and a reason comment
src/domain/pricing.ts:12:34: [no-platform-calls] `Date.now()` outside infra/ — fix: take a Cap.Clock capability (deps.clock.now()) so the domain stays pure and testable
two-track-check: 14 file(s), 2 error(s), 1 review item(s), 0 allowed (config: two-track-check.json)
```

## Why a separate package, and why TypeScript 6

`two-track` has zero runtime dependencies and is guarded only by the type checker. Several of the most damaging mistakes are invisible to types: an ignored `Result`, a floating promise, a platform call in the domain, a forged brand. Catching the first two needs the type checker's API, which TypeScript 7 (the native compiler) no longer exposes to JavaScript. So the checker is a dev-time tool with its own dependency on `typescript@6.0.3`, the last release with a JS compiler API. Your project stays on TypeScript 7; the checker parses the same syntax.

## Rules

| Rule | Severity | Fires on | Fix |
|---|---|---|---|
| `ignored-result` | error | an expression statement (optionally `await`ed) whose value is a `Result`, or an array / promise of Results (`items.map(fallible);`) | handle it (`if (!r.ok) return r;`), `R.traverse`/`R.validateAll` for collections, or `void` it with a reason |
| `floating-async-result` | error | an un-awaited call whose value is a Promise | `await` and handle, return it, or `void` with a reason |
| `ignored-result-in-callback` | error | a callback passed where a `void`-returning function is expected (`forEach`, listeners) returns a Result — or a function reference returning one is passed directly | `R.traverse` / `R.validateAll` / `Async.mapConcurrent`, or a `for-of` with early return |
| `floating-async-callback` | error | an async callback in a `void` context (`forEach(async …)`) — its promise is dropped | `for-of` with `await`, or `Async.mapConcurrent` |
| `no-throw` | error | `throw` outside a function named `assertNever` | return `err(...)` on the error track |
| `no-try` | error | `try` | `R.fromThrowable` / `Async.tryPromise` at the interop edge in infra/ |
| `no-catch` | error | `.catch()` on a promise-typed receiver | `Async.fromPromise` |
| `no-generators` | error | generator functions, except an `async function*` in infra/ or lib/ (stream adapters) | early returns / `await` (decision 0002) |
| `no-freeze` | error | `Object.freeze` outside tests | readonly types (decision 0003) |
| `no-class` | error | class declarations/expressions | plain objects + functions |
| `no-any` / `no-non-null` / `no-ts-suppress` | error | `any`, `!`, `@ts-ignore`/`@ts-expect-error` (tests exempt from suppress) | precise types; decode; fix the error |
| `no-console` | error | `console.*` outside infra/, lib/, root | a Logger port at the edge |
| `no-process-env` | error | `process.env` outside the `root` layer (and tests) | decode configuration once in `main.ts` with `D.struct`; pass a typed `Config` down |
| `no-platform-calls` | error | `Date.now()`, `new Date()`, `Math.random()`, `randomUUID()`, `setTimeout`/`setInterval`, `fetch` outside infra/, lib/, root, tests | capabilities on `deps` |
| `layer-domain-imports` | error | domain/ importing anything but `allowedDomainImports` or itself | move the piece or invert the dependency |
| `layer-workflows-imports` | error | workflows/ importing infra/, `node:*`, or any bare module but `two-track` | ports on the deps record |
| `no-brand-cast` | error | `as <branded type>`, `as Brand<…>`, `as unknown as` outside `brandFiles` and tests | brands come from `D.brand`; re-brand through one helper in a brandFiles module |
| `no-bare-promise-all` | error | `Promise.all/allSettled/race/any` outside lib/ and tests | `Async.mapConcurrent` / `validateConcurrent` / `withTimeout` |
| `fetch-needs-signal` | error / review | `fetch` with no options or options lacking `signal` (error); non-literal or spread options (review) | pass the AbortSignal you were handed |
| `switch-default-without-assert-never` | error | a `default:` with no `assertNever` call | `match()` / `matchBy()` or `default: return assertNever(x)` |
| `review-unwrap-or` | review | `R.unwrapOr` / `O.unwrapOr` | confirm the fallback is correct by design |
| `review-decode-unknown` | review | `D.unknown` | decode the real shape |
| `allow-needs-reason` | error | a suppression comment with no reason | write the reason |

Branded types are detected through the type checker (a property whose symbol starts with `__@BrandTag`), so aliases like `Cents` are recognised, not just the literal text `Brand<…>`.

## Configuration

Optional `two-track-check.json` in the project directory. Defaults match the layout the `two-track-fp-skill` scaffolds:

```json
{
  "layers": {
    "domain": ["src/domain"],
    "workflows": ["src/workflows"],
    "infra": ["src/infra"],
    "lib": ["src/lib"],
    "root": ["src/main.ts"]
  },
  "brandFiles": ["**/decoders.ts", "**/brands.ts", "**/domain/types.ts"],
  "allowedDomainImports": ["two-track"],
  "testFiles": ["**/*.test.ts", "test/**"],
  "include": []
}
```

Entries are paths relative to the project directory; a pattern with `*`/`**` is a glob, anything else is a directory or file prefix. `include`, when non-empty, restricts which files are checked. Files in no layer still get the universal rules (throw, try, class, any, ignored results, …) but not the layer-specific ones.

## Suppressing a finding

```text
// two-track-check-allow no-try JSON.parse is the one interop edge of this module
try { ... } catch { ... }
```

The comment goes on the same line or the line before, names the rule, and must give a reason; a reasonless suppression is itself an error. Suppressions are counted in the summary so they stay visible.

## Programmatic API

```ts
import { check, formatFinding } from "two-track-check";

const report = check({ projectDir: ".", project: "tsconfig.json" });
if (report.ok) report.findings.forEach((f) => console.log(formatFinding(f)));
```

## Development

```bash
pnpm --filter two-track-check check   # typecheck + tests with per-file coverage thresholds + build + self-check
pnpm --filter two-track-check test:coverage # HTML and JSON reports in tools/check/coverage/
```

The `violations` fixture annotates every offending line with `// expect: <rule>`; the test asserts the reported set equals the annotated set exactly, so a new rule needs a fixture line and a fixture line needs a rule.
