# 0014 — Decoder hot path: value-or-Failure protocol, inline primitives, and opt-in `compile`

Status: accepted        Date: 2026-10-06

## Context

Measured against the field (`bench/cross/decoders-vs.mjs`, decision 0013's amendment to the README), two-track's decoders were 15–30% faster than Zod and Valibot but 3.7x slower than ArkType on valid input (855 vs 230 ns per object on the bench schema). The README had claimed parity with compiled validators without a measurement. A profile put ~460 of the 855 ns in the per-field path `push`/`pop`, the per-field `Result` allocation, the closure layers of stacked refinements, and the megamorphic call per field.

A second measurement set the floor: a hand-written generic loop over a key array cannot decode a four-field object in under ~94 ns on V8, because `obj[key]` with a non-literal key is a generic property load. Literal-key code — `o.id`, `out.id = …` — does the same in ~13 ns. That is the whole of ArkType's advantage, and only code generation produces literal keys.

## Decision

Two layers, both keeping the public contract (messages, paths, accumulation order, `Result` encoding) byte-for-byte:

1. **The interpreter's internal protocol changed.** `run` now returns the decoded value itself or a private `Failure` marker (a plain object carrying a private symbol), so a `Result` is allocated once per `decode` call rather than once per field. Containers pass each child its key and push onto the path only when descending into another container; a leaf materializes `[...path, key]` only when it records an issue. Primitive refinements (`pattern`, `min`, `max`, `nonEmptyString`, …) fuse into one check loop on the primitive, and `struct`/`array` run primitive fields inline from one descriptor per field, so a primitive field never leaves the container's function. `struct` skips `Object.hasOwn` for non-risky keys on plain objects (prototype `Object.prototype` or `null`), which cannot inherit anything else. Interleaved same-process A/B: bench schema 730 → 615 ns, flat four-field struct 219 → 166 ns. Against the measured floor (94 ns) the interpreter is now within ~1.7x; the remainder is `Object.getPrototypeOf`, the `Result` wrap at the top, and the generic keyed loads that define the floor.

2. **`D.compile(decoder)` is an opt-in code generator** for the structural subset — struct, array, primitives with fused checks, optional, nullable, option, literal — emitting literal-key code; any other node (map, andThen, custom, lazy, oneOf, taggedUnion, json, record, refine over a non-primitive) is called through its `run` from the generated code, so semantics are the interpreter's by construction. It uses `new Function`. Where that is forbidden (CSP without `unsafe-eval`, Cloudflare Workers, some extensions) `compile` returns the decoder unchanged, so it is always safe to call and never slower. Compiled bench schema: 263 ns in the A/B, 299 ns on the dist bench (ArkType 213); flat struct 55 ns; on the 10%-invalid workload compiled two-track is 4x faster than ArkType because its issues are cheap; on the JSON-text path they are at parity.

## Evidence

- `test/decode-compile.test.ts`: `compile(d).decode(x)` deep-equals `d.decode(x)` for a 13-field decoder mixing every node kind, over 300 generated valid-and-corrupted wire objects and 800 `fc.anything()` inputs; inherited members, prototype-less objects, class instances and an own `__proto__` key behave identically and never produce a polluted output prototype; a stubbed `Function` global proves the CSP fallback.
- The generator's one bug found by the property — `var` is function-scoped, so an issue list declared inside a generated loop aliased the previous iteration's and grew without bound — is why the equivalence property exists; it is fixed by explicit per-iteration initialization.
- Numbers and method: `docs/references/benchmarks.md` ("Decoders versus …" and "Decoder floor and A/B").

## Alternatives

- **Leave it and point at ArkType.** Rejected: the README made a claim; closing the gap honestly was better than deleting the claim, and the interpreter gains cost nothing to users.
- **Compile by default.** Rejected: `new Function` is a CSP decision users must make knowingly, and generated code is less legible for debugging. Opt-in with a guaranteed-equivalent fallback keeps both.
- **Return the input object when nothing was transformed** (ArkType's no-morph path, ~10 ns). Rejected: the output must contain only declared keys and must not alias the input; those are correctness properties users rely on.

## Consequences

- `two-track/decode` selective bundles grew ~1 kB for the faster protocol; `compile` is tree-shaken unless imported (verified). Bundle budgets raised with the reason recorded in `bench/bundles.mjs`.
- `decode.ts` is now a thin public surface over `decode-internal.ts`, `decode-core.ts`, `decode-dates.ts`, `decode-compile.ts` (file-size invariant); `LAYERS` and ARCHITECTURE.md list them.
- The skill's `performance.md` and `boundaries.md` say when to call `compile`: a CPU-bound path decoding many valid objects, in a runtime where `new Function` is permitted.
