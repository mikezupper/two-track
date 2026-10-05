# 0002 — No generator-based do-notation

Status: accepted        Date: 2026-10-05

## Context

neverthrow's `safeTry` and Effect's `Effect.gen` give Rust-`?`-like ergonomics by running a generator and short-circuiting on the first `Err` yielded. It is the most requested convenience in any Result library.

## Decision

The library does not ship a generator-based sequencing helper, and the invariants linter bans `function*` and `yield` in `src/`. The companion skill bans them in application hot paths. The sanctioned forms are straight-line early return in synchronous code and `await` with `Async.andThen` in asynchronous code.

## Evidence

Same workload as 0001: generator do-notation ran in 970 ms on Node 24 and 488 ms on Bun, versus 11.7 / 10.5 ms for early returns — 40x to 80x. Each `yield` allocates an iterator result object and suspends/resumes the frame; the engine cannot inline across it.

## Alternatives

- **Ship it with a warning** — rejected: a convenience that is shipped becomes the default idiom, and this library's reason to exist is the fast idiom.
- **Macro/transform** (Babel/SWC plugin that rewrites `?`-like syntax to early returns) — rejected for now: it adds a build-time dependency and breaks native type stripping. Noted in the tech-debt tracker as a possible future *separate* package.

## Consequences

- Early returns are the canonical style and are documented as "what Rust's `?` desugars to". They are pure and referentially transparent.
- `no-generators` invariant.
- The README's tradeoffs table lists this as the single largest ergonomic difference from neverthrow and Effect.
