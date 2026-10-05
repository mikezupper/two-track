# 0004 — Zero runtime dependencies; capabilities as values

Status: accepted        Date: 2026-10-05

## Context

A railway library needs a handful of helpers beyond `Result`: validation, bounded concurrency, retry, timeout, randomness for jitter, ids, and a clock. Each exists as an npm package. Effect provides all of them plus a dependency-injection runtime (`Layer`, the `R` type parameter).

## Decision

`dependencies` in `package.json` is empty and the invariants linter fails the build on any addition (including peer dependencies). Every helper is implemented in `src/` (10–150 lines each). Dependency injection is a plain capability record passed as the first argument to workflows; the library ships the four capability interfaces every app needs (`Clock`, `Sleeper`, `Random`, `IdGen`) with production and deterministic implementations. Nothing in `src/` imports `node:*`.

## Evidence

- Harness engineering observation: in-repo reimplementations of small helpers are fully legible to agents, can be tested to 100%, and behave exactly as the runtime expects; opaque upstream behaviour costs more than it saves.
- Portability: without `node:` imports and with only web-standard globals, the same build runs in browsers, workers, Bun, Deno, and edge runtimes. Verified on Node 24 and Bun 1.3.
- The helpers total under 400 lines including docs, so the maintenance cost is bounded.

## Alternatives

- **Peer-depend on a validation library** (Zod/Valibot/ArkType) — rejected: it would be the only dependency, its error shape would leak into ours, and hand-written `typeof` decoders are as fast as anything compiled. A thin adapter can live in user code if a project already uses one.
- **A `Reader`-style requirements type** to mimic Effect's `R` — rejected: without a runtime it is a closure per call and the types do not compose across `await`.

## Consequences

- `zero-runtime-deps`, `no-node-imports`, `no-platform-time`, `no-platform-random`, `no-platform-timers` invariants.
- Workflows take `deps` first by convention (documented in the skill); one composition root per app.
- Dev dependencies (TypeScript, vitest, fast-check, coverage) are explicitly fine.
