# 0001 — Result and Option are two plain object shapes with a boolean discriminant

Status: accepted        Date: 2026-10-05

## Context

Every railway library picks an encoding for its Result type, and the choice fixes the library's performance ceiling and its ergonomics. The candidates were: two plain shapes with a boolean `ok`; one monomorphic shape with both `value` and `error` always present; a `_tag: "Ok" | "Err"` string discriminant (Effect/fp-ts style); a class with methods (neverthrow style); and a Go-style `[error, value]` tuple.

## Decision

`Result<E, A>` is `{ readonly ok: true; readonly value: A } | { readonly ok: false; readonly error: E }`, built by `ok()` and `err()` as object literals. No prototype, no methods, no class. `Option<A>` follows the same rule with a `some` discriminant and a shared `none` singleton. The encoding is part of the public contract because user code narrows on `r.ok` directly.

## Evidence

Three-step railway, 1M items, best of 7 (see `docs/references/benchmarks.md`, "Encodings"):

| Encoding | Node 24 | Bun 1.3 |
|---|---|---|
| two shapes, boolean `ok`, early return | 11.7 ms | 10.5 ms |
| Go tuple `[err, value]` | 18.3 ms | 13.2 ms |
| one monomorphic shape | 21.5 ms | 13.5 ms |
| `_tag` string discriminant | 23.7 ms | 14.9 ms |
| class + fluent `.andThen` | 34.9 ms | 24.1 ms |

The monomorphic-shape folklore does not hold on current V8/JSC: the extra `undefined` field costs more than a two-map inline cache. A string discriminant costs a string comparison per check. Classes pay for method dispatch and a closure per step.

## Alternatives

- **`_tag` discriminant** — rejected for `Result`/`Option` (2x), but it is the convention for *domain* unions and errors (`tagged.ts`), where readability of `match` cases matters more than nanoseconds and the string is also the serialized form.
- **Class with methods** — rejected as the core type; fluent style is permitted in user code outside hot paths.
- **Tuple** — fast, but `r[0]` is less legible than `r.error`, and tuples do not narrow as cleanly with destructuring.

## Consequences

- Hot paths use early returns (`if (!r.ok) return r`) and are at the baseline; combinators (`R.andThen`) add one closure and stay around 1.8x in the source-level `bench:check` gate (enforced < 4x); measured on the built `dist` with a 5-rep harness (`bench/cross/railway-vs.mjs`) the same ratio reads 2.3–3.0x, which is build-form and harness variance, not a regression.
- `no-class` invariant in `src/`.
- Renaming `ok`/`value`/`error` or `some` is a major version.
