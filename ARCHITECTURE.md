# ARCHITECTURE.md

The top-level map of `two-track`. If the `LAYERS` table in `scripts/invariants.ts` and this file disagree, the linter is right and this file needs a fix.

## Shape

One library package with a root entry, direct module subpaths and the separate `two-track/testing` entry, plus a dev-time tool package in `tools/check`. There is no runtime: every library module exports plain functions and types; module-level values are the shared `none`, `unit` and tagged-error singletons, and `decode-compile`'s one-time `canCompile` probe (a `/* @__PURE__ */` `new Function` test). Lanes and semaphores hold *contained* state inside a closure the caller creates, which is the same shape as a capability.

Lowest layer first; a module imports only from layers below it (the `LAYERS` table in `scripts/invariants.ts` is the enforced form):

1. `result`, `brand`, `tagged`, `match`, `fn`, `capabilities` — the core algebra; import nothing.
2. `option` → `result`.
3. `decode-internal` → `result`, `option`; then `decode-core` → `decode-internal`, `brand`; `decode-dates` → `decode-core`; `decode-compile` → `decode-internal`; `decode` re-exports those three.
4. `async` → `result`, `capabilities`, `tagged`; `lanes` → `result`, `tagged`, `capabilities`, `async`.
5. `testing` → `result`, `option`, `decode` (the separate `two-track/testing` entry; never imported by `index`).
6. `index` — the `two-track` entry: top-level types and constructors plus the namespaces `R`, `O`, `D`, `Async`, `Cap`, `Lane`.

## Modules

| Module | Responsibility | Imports | Lines (approx.) |
|---|---|---|---|
| `src/result.ts` | `Result<E, A>`; map/andThen/orElse/match; all/traverse/validateAll/partition; `fromThrowable` (one of four interop edges) | — | 181 |
| `src/option.ts` | `Option<A>` with shared `none`; boundary converters | `result` (type-level, for `toResult`) | 66 |
| `src/brand.ts` | `Brand<T, Name>` — type-only | — | 16 |
| `src/tagged.ts` | `Tagged`, `tagged()` constructors, `hasTag` guard | — | 34 |
| `src/match.ts` | `match`, `matchBy` (exhaustive by type), `assertNever` (the one `throw`) | — | 54 |
| `src/fn.ts` | `pipe`, `identity`, `constant` | — | 25 |
| `src/capabilities.ts` | `Clock`, `Sleeper`, `Random`, `IdGen`; system + deterministic implementations. The only module allowed to touch platform time/random/timers | — | 148 |
| `src/decode-internal.ts` | The decoder protocol shared by the modules below: `Failure` marker, `fail`/`merge`, `make`, `primIssue` (inline primitive check), `Field`/`Node` metadata. Not re-exported | `result`, `option` | 141 |
| `src/decode-core.ts` | Primitives with fused checks, refinements, `brand`, containers (`struct` with per-field descriptors and inline primitives), `taggedUnion`, `oneOf`, `json`, `lazy` | `decode-internal`, `result`, `option`, `brand` | 336 |
| `src/decode-dates.ts` | `isoDate` (strict), `dateFromString` (permissive, named so) | `decode-core`, `result` | 54 |
| `src/decode-compile.ts` | `compile`: opt-in literal-key code generation for the structural subset; opaque nodes call `run`; falls back when `new Function` is forbidden (decision 0014) | `decode-internal`, `option` | 182 |
| `src/decode.ts` | Public decoder surface: re-exports core + dates + `compile` (`D`, `two-track/decode`) | the three above | 10 |
| `src/async.ts` | `AsyncResult`; `fromPromise`/`tryPromise`; `mapConcurrent`/`validateConcurrent`/`all`; `retry`/`backoff` (`retriable` required); `withTimeout` | `result`, `capabilities`, `tagged` | 333 |
| `src/lanes.ts` | Trigger coordination (decision 0009): `switchLane`, `exhaustLane`, `queueLane`, `debounce`, `throttle`, `semaphore`; errors `Superseded`/`Busy`/`QueueFull` | `result`, `tagged`, `capabilities`, `async` | 321 |
| `src/testing.ts` | `two-track/testing` entry (decision 0011): `arbResult`/`arbOption`/`arbDecoded`, `functorLaws`/`monadLaws`, `decoderRoundTrip`/`decoderNeverThrows`/`decoderDoesNotMutate`; fast-check injected | `result`, `option`, `decode` | 198 |
| `src/index.ts` | Public surface (`two-track`) | all | 39 |
| `tools/check/` | **Separate package** `two-track-check` (decision 0010): dev-time CLI on TypeScript 6's compiler API; not part of the library's dependency graph | its own | — |

## Layers and permitted edges

Lowest first. A module may import only from layers below it (and within the "core algebra" layer, only as listed).

1. **Core algebra** — `result`, `brand`, `tagged`, `match`, `fn`, `capabilities`. Import nothing.
2. **Derived algebra** — `option` → `result`.
3. **Boundary** — `decode-internal` → `result`, `option`; `decode-core` → `decode-internal`, `result`, `option`, `brand`; `decode-dates` → `decode-core`, `result`; `decode-compile` → `decode-internal`, `option`; `decode` re-exports core, dates and `compile`.
4. **Shell** — `async` → `result`, `capabilities`, `tagged`; `lanes` → `result`, `tagged`, `capabilities`, `async`.
5. **Test support** — `testing` → `result`, `option`, `decode` (published separately as `two-track/testing`; never imported by `index`).
6. **Surface** — `index` → anything.

Forbidden everywhere in `src/`: `node:*` imports, platform time/random/timers (outside `capabilities.ts`; `withTimeout` in `async.ts` is the one documented `setTimeout`), classes, generators, `Object.freeze`, `throw` (outside `assertNever`), `try` (outside the four interop edges: `fromThrowable`, `tryPromise`, `D.json`, `decode-compile`'s `canCompile` probe), `.catch(`.

## Public contract

- `Result` encoding `{ ok, value } | { ok, error }` and `Option` encoding `{ some, value } | { some }` are public and stable (user code narrows on them).
- Top-level exports: every type each module exports (`Result`, `Ok`, `Err`, `OkOf`, `ErrOf`, `NonEmptyArray`, `Option`, `Some`, `None`, `Brand`, `Unbrand`, `Tagged`, `TagOf`, `Cases`, `CasesBy`, `Decoder`, `DecodeError`, `DecodeIssue`, `Infer`, `StructOf`, `PathSegment`, `AsyncResult`, `ConcurrencyOptions`, `RetryPolicy`, `BackoffOptions`, `Clock`, `Sleeper`, `Random`, `IdGen`), constructors (`ok`, `err`, `unit`, `some`, `none`), `match`, `matchBy`, `assertNever`, `tagged`, `hasTag`, `pipe`, `identity`, `constant`. The README's "Public surface" table lists the namespace members.
- Namespaces: `R` (result), `O` (option), `D` (decode), `Async`, `Cap` (capabilities), `Lane` (lanes).
- `two-track/testing` is a separate entry point so test-only code never lands in an application bundle.
- Direct module subpaths expose the existing modules for smaller consumer bundles (decision 0013); root namespace imports remain stable.
- On `Decoder`, `run` (the value-or-Failure, key-passing protocol), `prim`, `inner`, `node` and the `optional` marker are `@internal`: containers and `compile` read them and they may change without notice.

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
| `test/` | vitest: unit tests, fast-check law/round-trip properties, `*.properties.test.ts` model-based schedules for async/lanes/capabilities, `decode-compile.test.ts` (compiler ≡ interpreter), `testing.test.ts`, `defects.test.ts` and `review-regressions.test.ts` (one test per fixed defect), `architecture.test.ts` + `invariants.test.ts` (the invariants and their negative fixtures), `examples.test.ts`, `helpers/` |
| `bench/` | `encodings.ts` (the encoding table; `--check` enforces the ratio), `hot-paths.ts` (decoder/async CPU overhead), `lanes.ts` (lane throughput; `--check` enforces ratios vs a baseline), `bundles.mjs` (consumer bundle budgets), `cross/` (a private workspace with its own deps: decoders vs Zod/Valibot/ArkType, railway vs Ramda/Effect; report-only) |
| `scripts/` | `invariants.ts` (this repo's own rules, incl. property-test coverage) and `lint-invariants.ts` (the CLI); `fix-dts-extensions.ts` (post-build `.ts`→`.js` in declarations); `check-package.mjs` (consumer check) |
| `tools/check/` | `two-track-check`: the application-level checker (own package.json, TypeScript 6, vitest fixtures per rule, README) |
| `examples/` | `checkout.ts`: a full workflow — decode, price, reserve, retry, place — with fakes and an HTTP-ish edge |
| `docs/` | system of record: design docs + decisions, exec plans, quality score, references |
