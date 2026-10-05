# ARCHITECTURE.md

The top-level map of `two-track`. If the `LAYERS` table in `scripts/invariants.ts` and this file disagree, the linter is right and this file needs a fix.

## Shape

One package, one entry point, nine modules. There is no runtime: every module exports plain functions and types, and the only module-level state is the shared `none` and `unit` singletons.

```
                       ┌──────────────┐
                       │   index.ts   │   public surface (types + constructors + namespaces R O D Async Cap)
                       └──────┬───────┘
          ┌───────────────────┼─────────────────────┐
          ▼                   ▼                     ▼
   ┌─────────────┐     ┌─────────────┐       ┌──────────────┐
   │  decode.ts  │     │  async.ts   │       │  (re-exports) │
   │  boundary   │     │  shell      │       └──────────────┘
   └──┬───┬───┬──┘     └──┬──────┬───┘
      │   │   │           │      │
      ▼   ▼   ▼           ▼      ▼
 ┌────────┐ ┌─────────┐ ┌──────────┐ ┌────────────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐
 │brand.ts│ │option.ts│ │result.ts │ │capabilities.ts │ │tagged.ts │ │match.ts  │ │ fn.ts  │
 └────────┘ └────┬────┘ └──────────┘ └────────────────┘ └──────────┘ └──────────┘ └────────┘
                 └──────────► result.ts
```

## Modules

| Module | Responsibility | Imports | Lines (approx.) |
|---|---|---|---|
| `src/result.ts` | `Result<E, A>`; map/andThen/orElse/match; all/traverse/validateAll/partition; `fromThrowable` (one of three interop edges) | — | 190 |
| `src/option.ts` | `Option<A>` with shared `none`; boundary converters | `result` (type-level, for `toResult`) | 85 |
| `src/brand.ts` | `Brand<T, Name>` — type-only | — | 15 |
| `src/tagged.ts` | `Tagged`, `tagged()` constructors, `hasTag` guard | — | 40 |
| `src/match.ts` | `match`, `matchBy` (exhaustive by type), `assertNever` (the one `throw`) | — | 45 |
| `src/fn.ts` | `pipe`, `identity`, `constant` | — | 30 |
| `src/capabilities.ts` | `Clock`, `Sleeper`, `Random`, `IdGen`; system + deterministic implementations. The only module allowed to touch platform time/random/timers | — | 110 |
| `src/decode.ts` | `Decoder<A>`; primitives, refinements, `brand`, containers, `taggedUnion`, `oneOf`, `json`, `lazy` | `result`, `option`, `brand` | 300 |
| `src/async.ts` | `AsyncResult`; `fromPromise`/`tryPromise`; `mapConcurrent`/`validateConcurrent`/`all`; `retry`/`backoff`; `withTimeout` | `result`, `capabilities` | 230 |
| `src/index.ts` | Public surface | all | 40 |

## Layers and permitted edges

Lowest first. A module may import only from layers below it (and within the "core algebra" layer, only as listed).

1. **Core algebra** — `result`, `brand`, `tagged`, `match`, `fn`, `capabilities`. Import nothing.
2. **Derived algebra** — `option` → `result`.
3. **Boundary** — `decode` → `result`, `option`, `brand`.
4. **Shell** — `async` → `result`, `capabilities`.
5. **Surface** — `index` → anything.

Forbidden everywhere in `src/`: `node:*` imports, platform time/random/timers (outside `capabilities.ts`; `withTimeout` in `async.ts` is the one documented `setTimeout`), classes, generators, `Object.freeze`, `throw` (outside `assertNever`), `try` (outside the three interop edges), `.catch(`.

## Public contract

- `Result` encoding `{ ok, value } | { ok, error }` and `Option` encoding `{ some, value } | { some }` are public and stable (user code narrows on them).
- Top-level exports: types (`Result`, `Ok`, `Err`, `Option`, `Some`, `None`, `Brand`, `Tagged`, `Decoder`, `DecodeError`, `AsyncResult`, …), constructors (`ok`, `err`, `unit`, `some`, `none`), `match`, `matchBy`, `assertNever`, `tagged`, `hasTag`, `pipe`, `identity`, `constant`.
- Namespaces: `R` (result), `O` (option), `D` (decode), `Async`, `Cap` (capabilities).
- `Decoder.run` is marked `@internal`; it is the mutable-path-stack entry used by containers and may change.

## Where application code goes (the skill's assumption)

```
your-app/src/
├── domain/      types, decoders, errors (tagged), pure functions — sync; imports only "two-track"
├── workflows/   async functions (deps, command) => AsyncResult<Error, Event|Value>
├── infra/       implementations of the capability interfaces (db, http, queue, clock)
└── main.ts      the one composition root: builds the capability record, runs
```

## Supporting directories

| Directory | Purpose |
|---|---|
| `test/` | vitest: unit tests, fast-check law/round-trip properties, `architecture.test.ts` (runs the invariants), `examples.test.ts` |
| `bench/` | `encodings.ts` (the encoding table; `--check` enforces the ratio), `cross-library.mjs` (Ramda/Effect rows; plain JS, needs those packages installed) |
| `scripts/` | `invariants.ts` (the rules) and `lint-invariants.ts` (the CLI) |
| `examples/` | `checkout.ts`: a full workflow — decode, price, reserve, retry, place — with fakes and an HTTP-ish edge |
| `docs/` | system of record: design docs + decisions, exec plans, quality score, references |
