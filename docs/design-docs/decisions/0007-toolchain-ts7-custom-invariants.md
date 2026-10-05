# 0007 — TypeScript 7 for types; a custom invariants script for architecture; no ESLint for now

Status: accepted        Date: 2026-10-05

## Context

The sibling skills target TypeScript 7 (the native compiler). `typescript-eslint` 8.71 refuses to load against TS 7.0 ("does not support TS 7.0"); its guidance is to run a parallel TS 6 install, which `pnpm` overrides did not make work for the peer dependency. Meanwhile most of the rules this repository cares about (banned constructs, layer direction, docs integrity, dependency count) are repository-specific and are better expressed as a custom linter whose messages carry remediation text.

## Decision

- `tsc` 7.0 with every strict flag (`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`, `noImplicitOverride`, `erasableSyntaxOnly`, `verbatimModuleSyntax`) is the type-level enforcer.
- `scripts/invariants.ts` is the architecture-and-taste enforcer. It is run as a script (`pnpm lint`) and as a structural test (`test/architecture.test.ts`) so `pnpm test` alone catches drift. Every message ends with `— fix: …`.
- No ESLint. Revisit when typescript-eslint supports TS ≥ 7.1 (tracked in tech debt); the type-aware rules worth adding then are `switch-exhaustiveness-check` and `no-floating-promises`.
- Scripts, benches, and examples run as `.ts` under Node's native type stripping; `erasableSyntaxOnly` guarantees they always can.

## Evidence

- Attempted `pnpm.overrides` for `@typescript-eslint/*>typescript: 6.0.3`; the peer still resolved to 7.0.2 and ESLint failed to load.
- The harness-engineering write-up's experience: custom lints with injected remediation are what let agents comply without a human; generic lint output is not.

## Alternatives

- **Pin TypeScript 6** — rejected: it would diverge from the sibling skills and lose `erasableSyntaxOnly`-era defaults the examples rely on.
- **Biome** — not evaluated yet; a candidate when revisiting.

## Consequences

- Exhaustiveness is guaranteed by the `match` API's types and `assertNever`, not by a lint rule.
- Floating promises are a reviewer check (every `AsyncResult` is awaited or returned).
- `scripts/invariants.ts` must be updated when a module is added (the `layer-registered` rule says so).
