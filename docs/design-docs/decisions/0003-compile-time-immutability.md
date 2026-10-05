# 0003 — Immutability is a compile-time property

Status: accepted        Date: 2026-10-05

## Context

Functional code wants immutable data. JavaScript offers `Object.freeze` at runtime and `readonly` at the type level.

## Decision

Immutability is expressed only in types: `readonly` fields, `ReadonlyArray`, `as const`. The library never calls `Object.freeze` and the linter bans it in `src/`. Contained local mutation inside a function with a pure signature (filling a pre-sized array, a decoder's path stack) is idiomatic and allowed. Tests may freeze fixtures to catch accidental mutation.

## Evidence

Freezing every result cost 123 ms (Node) / 213 ms (Bun) versus 11.7 / 10.5 ms unfrozen: 10x to 20x. `Object.freeze` also only protects the top level, so it provides a false sense of deep immutability.

## Alternatives

- **Freeze in development only** — rejected: dual behaviour between dev and prod is a source of heisenbugs, and the type-level guarantee already catches the mistakes that matter at compile time.
- **Persistent data structures** (immutable.js-style) — rejected: a runtime dependency with a 3–10x cost on reads and a foreign API.

## Consequences

- `no-freeze` invariant.
- Decoders never mutate their input (tested by property).
- The companion skill bans mutating array methods and reassignment on escaping data via its review greps.
