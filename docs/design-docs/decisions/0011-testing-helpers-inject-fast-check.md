# 0011 — `two-track/testing`: law and round-trip helpers that take fast-check as a parameter

Status: accepted        Date: 2026-10-05

## Context

The library proves its own functor/monad laws and decoder round-trips with fast-check, but gave users nothing to prove theirs. "Laws are tests" (core belief 8) should cost one line per combinator or decoder, not a copy of our test file. fast-check cannot become a dependency (decision 0004), and an optional peer dependency is still a dependency.

## Decision

`src/testing.ts`, published as the `two-track/testing` subpath, exports `arbResult`, `arbOption`, `arbDecoded`, `functorLaws`, `monadLaws`, `decoderRoundTrip`, `decoderNeverThrows` and `decoderDoesNotMutate`. Every helper takes the fast-check module as its first argument, typed by a minimal structural `FastCheckLike` interface, so the real `fast-check` v4 module is passed without casts and the package declares no dependency. Law helpers call `fc.assert(fc.property(...))` themselves.

## Evidence

- Capability injection is already the library's answer to dependencies (decision 0004); applying it to the test generator keeps one idiom.
- Tested: the real `fc` is assignable to `FastCheckLike`; the laws pass for `R` and `O` and fail for a deliberately broken `map`.

## Alternatives

- **Separate npm package depending on fast-check** — viable later; rejected for now to keep one repo and one version.
- **Schema-derived arbitraries** (Effect-style) — would need a schema runtime; `arbDecoded` (filter a raw arbitrary through the decoder) is the zero-runtime approximation and is documented with its exhaustion caveat.

## Amendment (2026-10-06, alignment sweep)

The exported surface also includes `structuralEq` (the default `Eq`, JSON-based, with documented limits) and the types `FastCheckLike`, `Arb`, `Eq`. The interop claim is one-directional: the real `fc` is accepted without casts, but the arbitraries the helpers *return* are the structural `Arb<T>`, which fast-check's own `fc.record`/`fc.func` do not accept without `as fc.Arbitrary<T>` (tech-debt tracker). `monadLaws` therefore derives its Kleisli arrows when `arbKleisli` is omitted.

## Consequences

- The skill's `testing.md` uses these helpers for every custom combinator and decoder.
- `FastCheckLike` must be widened when a helper needs a new fast-check function; it is part of the public surface.
