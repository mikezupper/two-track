# 0010 — `two-track-check`: a separate dev-time checker with its own dependencies

Status: accepted        Date: 2026-10-05

## Context

Correctness in this design is *checked*, not *enforced* (README, "Is this real functional programming?"). The type checker covers narrowing and exhaustiveness. It cannot see purity, layer direction, forged brands, or — the worst foot-gun — an ignored `Result`: calling a `Result`-returning function as a statement, or not awaiting an `AsyncResult`, makes the error vanish silently. Rust has `#[must_use]`; TypeScript has nothing. The scaffold's copied `scripts/invariants.ts` rots per project, and a user without the skill gets nothing at all.

## Decision

Ship the checks as a tool, `two-track-check`, in `tools/check/` of this repository as a separate workspace package with its own dependencies. The library keeps zero. The checker depends on **TypeScript 6.0.3** because it needs the JS compiler API for type-aware rules, and TypeScript 7 (which the library and apps compile with) has no JS API. Rules are AST- and type-based, every finding carries `— fix: …`, inline suppressions require a reason, and `review`-severity findings (`R.unwrapOr`, `D.unknown`) are reported without failing unless `--strict`.

Rule families: banned constructs (`no-throw`, `no-try`, `no-catch`, `no-generators`, `no-freeze`, `no-class`, `no-any`, `no-non-null`, `no-ts-suppress`, `no-console`), platform calls outside infra (`no-platform-calls`), layer direction (`layer-domain-imports`, `layer-workflows-imports`), brand forging (`no-brand-cast`), concurrency hygiene (`no-bare-promise-all`, `fetch-needs-signal`), exhaustiveness (`switch-default-without-assert-never`), and the type-aware must-use pair (`ignored-result`, `floating-async-result`).

## Evidence

- Harness-engineering: rules whose messages carry remediation let agents comply without a human; a shared tool beats a copied script because it is versioned once.
- The must-use rule needs real types (is this expression a `Result`?), which only the compiler API can answer; a regex cannot.
- Keeping the checker out of the library's dependency graph preserves decision 0004 and the browser/edge portability of `src/`.

## Alternatives

- **typescript-eslint plugin** — blocked: no TS 7 support (decision 0007); revisit as an additional distribution when it lands.
- **Checker inside the library package** — rejected: it would pull TypeScript 6 and Node APIs into a package that must stay runtime-free.

## Consequences

- Apps add `two-track-check` as a devDependency and run it in `lint`/CI (skill `scaffold.md`); the skill's `code-review.md` runs it first and keeps the greps as the fallback.
- The library's own `scripts/invariants.ts` stays as the repo's self-check (it also covers docs integrity, which the checker does not).
- Tech debt: the "no type-aware lint" item is retired by this decision.
