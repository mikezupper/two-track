# 0008 — Data-first signatures, module namespaces, no point-free style

Status: accepted        Date: 2026-10-05

## Context

FP libraries in JavaScript split between data-last/curried APIs (Ramda, fp-ts, Effect's dual signatures) that enable point-free `pipe(x, map(f), chain(g))`, and data-first APIs (Remeda's default, neverthrow methods) that read like method calls.

## Decision

Every function takes the data first: `R.map(result, f)`, `D.refine(decoder, pred, msg)`, `Async.retry(run, policy)`. No curried variants. Functions are grouped under short namespaces (`R`, `O`, `D`, `Async`, `Cap`) so `R.map` and `O.map` coexist, while the constructors written constantly (`ok`, `err`, `some`, `none`, `unit`, `match`, `matchBy`, `assertNever`, `tagged`, `hasTag`, `pipe`, `identity`, `constant`) are top-level. `pipe(value, f, g)` exists for composing plain unary functions.

## Evidence

- Ramda's curried/placeholder dispatch cost 20x in the cross-library benchmark; a curried variant allocates a closure per use.
- TypeScript infers data-first calls in one pass; data-last generic pipelines are where inference fails and `any` creeps in (the known pain point of typed Ramda).
- Namespaced imports keep the top-level surface small and make the module of origin visible at the call site, which helps agents navigate.

## Alternatives

- **Dual signatures** (Effect style: both `map(r, f)` and `map(f)(r)`) — rejected: doubles the type surface and invites the slow form.
- **Methods on a class** — rejected per 0001.

## Consequences

- Point-free style is explicitly unsupported; the README says so.
- Subpath imports are not provided in 0.x; the namespaces are the grouping mechanism.
