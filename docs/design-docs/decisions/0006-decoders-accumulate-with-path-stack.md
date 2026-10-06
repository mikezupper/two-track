# 0006 — Decoders accumulate all issues; the path is a mutable stack owned by the call

Status: accepted        Date: 2026-10-05

## Context

Parse-don't-validate needs a decoder that turns `unknown` into a domain type. Two design questions: fail on the first issue or report all of them, and how to track the path to each issue without allocating on the success path.

## Decision

Containers (`struct`, `array`, `record`) run every child and collect every issue; `taggedUnion` reports the issues of the one selected variant; `oneOf` reports the last alternative's issues. The path is a single mutable array created per top-level `decode` call; containers `push`/`pop` keys around child calls and an issue copies the path only when it is recorded. The `run(input, path)` signature is `@internal`.

## Evidence

- Boundaries should show users every problem at once (Wlaschin's validation-applicative argument); fail-fast belongs inside workflows, where `Result.andThen` already provides it.
- The success path allocates only the output object, so decoding is straight-line `typeof` checks — the same lower bound that compiled validators reach.
- Property tests: round-trip on generated values, JSON round-trip, input never mutated, never throws on `fc.anything()`.

## Alternatives

- **Immutable path arrays per level** — rejected: one allocation per field on the success path.
- **Fail-fast decoders with a separate `validateAll`** — rejected: the common case (HTTP body) wants accumulation, and the two-mode API doubled the surface.

## Amendment (2026-10-05, full project review)

Object decoding reads own fields; declared or record `__proto__` keys remain ordinary own data properties on a normal output object. `pattern` owns its RegExp and resets its index before testing, preserving the caller's state and making global/sticky patterns deterministic. Issue concatenation uses a bounded loop rather than argument spread, which formerly overflowed on large nested failures. `oneOf` allocates its fallback issue only for an empty alternative list. These behaviors are covered by [boundary regressions](../../../test/review-regressions.test.ts).

## Consequences

- `D.optional` is a marker read by `struct` so absent keys become `?:` in the inferred type.
- `D.brand` is the one sanctioned cast and sits behind the refinement it brands.
- `formatIssues` renders `path: message` lines for 400 responses and logs.
