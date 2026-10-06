# two-track — zero-dependency railway-oriented TypeScript

[![CI](https://img.shields.io/badge/CI-GitHub_Actions-2088FF?logo=githubactions&logoColor=white)](.github/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0_strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Runtime deps](https://img.shields.io/badge/runtime_deps-0-success)](#decision-4-zero-runtime-dependencies)
[![Paradigm](https://img.shields.io/badge/paradigm-functional-8A2BE2)](https://fsharpforfunandprofit.com/series/thinking-functionally/)
[![ROP](https://img.shields.io/badge/errors-railway--oriented-orange)](https://fsharpforfunandprofit.com/rop/)
[![Types](https://img.shields.io/badge/illegal_states-unrepresentable-success)](https://fsharpforfunandprofit.com/series/designing-with-types/)
[![Testing](https://img.shields.io/badge/testing-property--based-blueviolet)](https://fsharpforfunandprofit.com/series/property-based-testing/)
[![throw](https://img.shields.io/badge/throw-banned-red)](#conventions)
[![any](https://img.shields.io/badge/any-banned-red)](#conventions)
[![generators](https://img.shields.io/badge/generators-banned_(80x)-red)](#decision-2-no-generator-do-notation)
[![Harness](https://img.shields.io/badge/repo-agent--first-d97757)](#harness-engineering-how-this-repository-is-organized)
[![License](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

`two-track` is a ~2,100-line TypeScript library that gives you Scott Wlaschin's [two-track model](https://fsharpforfunandprofit.com/rop/) — `Result`, `Option`, parse-don't-validate decoders, exhaustive matching, an async railway with bounded concurrency, retry and timeouts, and injectable capabilities — with **no runtime dependencies** and **no runtime**. Every abstraction lives in the type checker and vanishes at build time. The measured cost of the railway is about 12 nanoseconds per three-step pipeline, which is the cost of three small object allocations and nothing else.

It is the third member of a family of opinionated functional-programming skills for coding agents:

| Skill | Realization of the two-track model | What you pay |
|---|---|---|
| [rust-fp-skill](https://github.com/mikezupper/rust-fp-skill) | `Result<T, E>` + `?`, enums, ownership, cargo-enforced layering | A compiled language |
| [effect-fp-skill](https://github.com/mikezupper/effect-fp-skill) | `Effect<A, E, R>`, Schema, Layer, fibers | A fiber runtime (~100x on CPU-bound paths) |
| **two-track** (this repo) + [two-track-fp-skill](https://github.com/mikezupper/two-track-fp-skill) | Plain discriminated unions, functions, `readonly` types | Nothing at runtime; discipline enforced by lint and review |

This README is deliberately long. It is the system of record for *why* the library is shaped the way it is, so that a human or an agent can reason about every decision from the repository alone.

---

## Table of contents

- [Motivation](#motivation)
- [The measurements](#the-measurements)
- [Principles](#principles)
- [Decisions](#decisions)
- [Architecture](#architecture)
- [API tour](#api-tour)
- [Conventions](#conventions)
- [Tradeoffs: what you give up](#tradeoffs-what-you-give-up)
- [Is this real functional programming?](#is-this-real-functional-programming)
- [Harness engineering: how this repository is organized](#harness-engineering-how-this-repository-is-organized)
- [Development](#development)
- [Installation and compatibility](#installation-and-compatibility)
- [Sources and credits](#sources-and-credits)
- [License](#license)

---

## Motivation

The railway-oriented pattern is free. The libraries that package it are not.

Agents and humans both reach for `throw`, `try/catch`, `null`, `any`, and unbounded `Promise.all` by default. The functional-programming tradition fixed each of these decades ago: errors as values on a typed second track, types that make illegal states unrepresentable, parsing untrusted data exactly once at the boundary, a pure core with effects at the edges, and properties instead of examples in tests. Two earlier skills in this family apply that tradition through Rust and through Effect. Both work. Both also carry a cost that is sometimes the wrong trade: Rust is a different language, and Effect is a runtime whose fiber interpreter costs two orders of magnitude on CPU-bound code.

The question this repository answers is: **what is the fastest expression of the two-track model that JavaScript engines can run, and how much of the algebraic type system survives?** The answer, measured rather than argued, is that a plain discriminated union with early returns is within noise of hand-written imperative code, that most of the algebra survives in TypeScript's type checker, and that the parts which do not survive (nominal types, effect tracking, enforced purity) can be held by lint and review at zero runtime cost.

The library exists so that the fast encoding is also the convenient one. Without it, every project re-derives `Result`, gets one of the slow encodings by accident (classes with fluent methods, generators for do-notation, `Object.freeze` for immutability), and never writes the property tests that prove the laws.

## The measurements

All numbers are from the benchmark scripts in [`bench/`](bench/) on a Linux workstation, Node 24.15 and Bun 1.3.14, best of several runs, and are recorded with their method in [docs/references/benchmarks.md](docs/references/benchmarks.md). The workload is a three-step railway (parse a quantity, price it, apply a discount) over one million items with a 10% failure rate. It is CPU-bound by design: in an I/O-bound service none of the JavaScript rows would be visible next to a database round trip. The point is to see what the abstraction itself costs.

**Encodings of the same railway, one million items**

Consumer bundles are also measured with Rolldown and esbuild (recorded 2026-10-06). Direct subpath imports avoid esbuild retaining an entire namespace: the Result example is **117 bytes minified** and the struct decoder example is **2,300 bytes** (1,124 before the decoder protocol rewrite, which bought 1.2–1.5x speed), versus 1,551 and 10,590 through root namespaces. See [the methods and measurements](docs/references/benchmarks.md#consumer-bundles).

| Encoding | Node 24 | Bun 1.3 |
|---|---|---|
| Two plain shapes, `{ ok: true, value }` / `{ ok: false, error }`, early return (**this library's baseline**) | 13 ms | 11 ms |
| `two-track` `R.andThen` combinators (closure per step) | 23 ms | 19 ms |
| Go-style tuple `[error, value]` | 18 ms | 13 ms |
| One monomorphic shape with both fields always present | 22 ms | 14 ms |
| `_tag: "Ok" / "Err"` string discriminant | 24 ms | 15 ms |
| Class with fluent `.andThen()` methods | 35 ms | 24 ms |
| `throw` / `try` / `catch` | 297–345 ms | 57–79 ms |
| Plain shapes plus `Object.freeze` on every result | 116–123 ms | 194–213 ms |
| Generator do-notation (`safeTry`, `Effect.gen` style) | 1002 ms | 464–488 ms |

**Other approaches to the same railway**

| Approach | Node 24 | Bun 1.3 |
|---|---|---|
| Ramda `pipeWith(chain)` over a Fantasy Land `Result` | 319 ms | 244 ms |
| Ramda idiomatic point-free (`ifElse`, `converge`, `when`, placeholders) | 620 ms | 553 ms |
| Effect 4 `Effect.gen`, one `runSync` per item | 2392 ms | 1410 ms |
| Effect 4 `Effect.forEach`, one `runSync` for the batch | 1919 ms | 1269 ms |
| Rust `Result` + `?` compiled to WASM, batched, integer arguments | 4 ms | 3 ms |
| Rust `Result` + `?` compiled to WASM, one call per item, integer arguments | 8 ms | 4 ms |
| Native Rust binary, same code | 1.5 ms | — |
| JSON serialize + parse of the same one million objects (the WASM boundary floor for real data) | 439 ms | — |

**Decoders versus the field** (`pnpm bench:cross`; identical schema, non-throwing APIs, 200k objects, best of 7; all four agree on validity)

| Library | Node 24, valid | Node 24, 10% invalid | Bun 1.3, valid | ns per valid object (Node / Bun) |
|---|---|---|---|---|
| two-track 0.1.0, interpreter | 140 ms | 140 ms | 67 ms | 699 / 335 |
| two-track 0.1.0, `D.compile` | **60 ms** | **62 ms** | 35 ms | **299 / 173** |
| zod 4.6.5 | 176 ms | 215 ms | 131 ms | 881 / 657 |
| valibot 1.5.0 | 209 ms | 215 ms | 133 ms | 1045 / 665 |
| arktype 2.2.7 | **43 ms** | 267 ms | **32 ms** | **213 / 160** |

Honest reading: the interpreter is 20–35% faster than Zod and Valibot. ArkType's JIT-compiled validator is still the fastest on valid input, because literal-key code is the only way below the ~94 ns floor of a generic keyed loop. `D.compile` generates that code for the structural subset and lands within 1.4x of ArkType on Node and 8% on Bun, 4x ahead of it when input is partly invalid, and at parity when the input is JSON text. It is opt-in because it uses `new Function`; where that is forbidden it returns the interpreter unchanged. Before the rewrite the interpreter stood at 855 ns, 3.7x behind; the profile, the floor measurement and the A/B are in the benchmarks file.

Three conclusions drive the whole design:

1. **The Result pattern is free; the libraries are what you pay for.** The baseline is within a few milliseconds of imperative code. Ramda's currying and placeholder dispatch cost 20x; Effect's fiber runtime costs 100x. Effect buys typed dependencies, interruption, and structured concurrency for that price. Ramda buys point-free notation.
2. **Three encodings destroy the speed and must be banned, not discouraged.** Generators (40–80x), `Object.freeze` (10–20x), and exceptions as control flow (5–30x). Fluent classes cost 2–3x and are permitted outside hot paths.
3. **WASM pays off only for pure, CPU-heavy kernels over binary-friendly data called in batches.** Real domain data must be serialized across the boundary, and that serialization alone costs 40x the entire JavaScript railway. `wasm-bindgen` also turns a Rust `Result` into a thrown exception, so the typed error track dies at the boundary. If you want a fast service, write it in Rust; if you want a fast JavaScript railway, use this.

## Principles

1. **Railway-oriented programming.** Every operation that can fail returns `Result<E, A>` (or `AsyncResult<E, A>`) with a named, structured `E`. Errors are values on a typed track, never exceptions. Compose the happy path; handle failures where you have the context to act.
2. **Make illegal states unrepresentable.** Branded primitives, tagged unions, `Option` for absence. If the compiler accepts it, it should be valid. Boolean flag pairs encoding a state machine are a union; two optional fields of which exactly one should be set are a union.
3. **Parse, don't validate.** Untrusted data is decoded exactly once at each boundary (HTTP, DB, env, queue, file, DOM) into domain types by a `Decoder`. The core only ever sees types that are already correct, and nothing past a decoder re-checks.
4. **Functional core, capability shell.** The domain is synchronous pure functions over `readonly` data. Workflows are async functions over domain types and a capability record. Infrastructure implements capability interfaces and is wired in one composition root.
5. **Totality.** Every function handles every input in its type. No partial functions, no `throw`, no `any`, no silent `undefined`, no `default` branch over a domain union.
6. **Zero-cost abstraction.** Every guarantee lives in the type checker and vanishes at build time. A construct that reintroduces a runtime cost for an abstraction the types already give you is a bug, and the benchmark is a test.

## Decisions

Each decision has an architecture decision record in [docs/design-docs/decisions/](docs/design-docs/decisions/) with its evidence and the alternatives rejected. The summaries here are the parts you need to use the library correctly.

### Decision 1: Result encoding — boolean `ok`, two literal shapes, no classes

`Result<E, A>` is `{ readonly ok: true; readonly value: A } | { readonly ok: false; readonly error: E }`. Two object literals, a boolean discriminant, no prototype, no methods. The folklore says to keep every object the same shape for monomorphic inline caches; measured on V8 and JavaScriptCore the two-shape version is fastest, because the extra `undefined` field costs more than a two-map inline cache. TypeScript narrows `ok` perfectly, so nothing is lost. Classes cost 2–3x from the method dispatch and closure per step and were rejected for the core type. `Option` follows the same rule with a `some` discriminant and a shared `none` singleton so absence allocates nothing.

### Decision 2: No generator do-notation

`safeTry`-style and `Effect.gen`-style generator sequencing cost 40–80x on the railway, because every `yield` allocates an iterator result and suspends the function. The library does not ship it and the invariants linter bans `function*` and `yield` in `src/`. The ergonomic price is real and documented: in the domain you write straight-line early returns (`if (!r.ok) return r;`, which is exactly what Rust's `?` desugars to), and in the shell you use `await` with `Async.andThen`. This is the single largest difference between `two-track` and both neverthrow and Effect.

### Decision 3: Immutability is a compile-time property

`Object.freeze` costs 10–20x and protects only the top level. Immutability here is `readonly` fields, `ReadonlyArray`, `as const`, and lint rules against mutating methods and reassignment. Contained local mutation inside a function whose signature is pure (a `for` loop filling a pre-sized array, a path stack inside a decoder) is idiomatic and allowed. Tests may freeze fixtures to catch violations for free.

### Decision 4: Zero runtime dependencies

`package.json` has an empty `dependencies` and the invariants linter fails the build if anything is added. Every helper this library needs — bounded concurrency, retry with backoff, timeout with `AbortSignal`, a seedable PRNG, decoders — is between 10 and 150 lines and lives in `src/` where it can be read, tested, and reasoned about in full. This follows the harness-engineering observation that it is often cheaper to reimplement a small subset of a dependency than to work around opaque upstream behavior, and it makes the library portable to browsers, edge runtimes, Bun, Deno, and Node without conditions. Dev dependencies that never ship (TypeScript, vitest, fast-check, coverage) are allowed and encouraged.

### Decision 5: `AsyncResult` is an eager `Promise<Result>` that never rejects

A lazy `Task` type gives nicer retry and cancellation semantics, but it is a runtime, it must be `run`, and every library in the ecosystem speaks promises. `AsyncResult<E, A>` is simply `Promise<Result<E, A>>`. The rule that makes it a railway: a promise on the railway never rejects. Rejection is reserved for defects. `Async.fromPromise` and `Async.tryPromise` are the only places `.catch` semantics appear, and every long-running combinator threads an `AbortSignal` so timeouts and first-failure cancellation actually stop work.

### Decision 6: Capabilities as values, not a requirements channel

Effect's third type parameter tracks dependencies in the signature. Without a runtime there is no way to do that in TypeScript, so dependencies are an explicit capability record passed as the first argument: `checkout(deps, command)`. Clock, randomness, IDs, and sleep are capability interfaces with production and deterministic implementations in the library; your repositories and gateways are interfaces you define. Fakes are plain objects, not a mocking library. One composition root builds the production record.

### Decision 7: TypeScript 7 for types, custom invariants for architecture, no ESLint (for now)

`typescript-eslint` does not support the TypeScript 7.0 native compiler, and the two-compiler workaround was judged not worth its complexity. Type-level enforcement comes from `tsc` with every strict flag on. Architectural and taste enforcement comes from [`scripts/invariants.ts`](scripts/invariants.ts), a custom linter whose every message ends with the fix, run both as a script and as a structural test. Revisit when typescript-eslint supports TS ≥ 7.1 (tracked in [docs/exec-plans/tech-debt-tracker.md](docs/exec-plans/tech-debt-tracker.md)).

### Decision 8: Data-first functions, namespaced by module

Every combinator takes the data as its first argument: `R.map(result, f)`, not `map(f)(result)`. Data-first infers types in one pass and allocates no intermediate closures. Point-free, data-last style is deliberately not supported; the measured cost of currying is where Ramda's 20x comes from. Functions are grouped in namespaces (`R`, `O`, `D`, `Async`, `Cap`) so `R.map` and `O.map` coexist, while the constructors you write constantly (`ok`, `err`, `some`, `none`, `match`, `tagged`, `pipe`) are top-level exports.

### Decision 9: Lanes are trigger coordination, not fan-out

`switchLane`, `exhaustLane`, `queueLane`, `debounce`, `throttle` and `semaphore` live in their own module because they answer a different question from `mapConcurrent` and hold contained state. Their failure modes are tagged errors, not dropped promises. They belong in the shell.

### Decision 10: The checker is a separate package on TypeScript 6

The one rule that matters most, an ignored `Result`, needs the compiler's type information, and TypeScript 7 has no JavaScript API. So `two-track-check` is its own dev-time package with its own dependencies, and the library keeps zero. The scaffolded per-project invariants script is retired in favour of it.

### Decision 11: Testing helpers inject fast-check

`two-track/testing` takes the fast-check module as a parameter typed by a minimal structural interface. The package gains law and round-trip helpers without gaining a dependency, which is the same capability-injection idiom the rest of the library uses. The arbitraries it returns are structural too, so handing one back to `fc.record` or `fc.func` needs a cast in the test (tracked in tech debt).

### Decision 12: Coverage is part of the complete check

`pnpm check` runs the tests with coverage and enforces 95% statements, lines and functions and 90% branches per executable file, in both the library and the checker package. A gate that is not in the definition of done is advice.

### Decision 13: Subpath entries and measured bundles

Every module is a subpath (`two-track/result`, `two-track/decode`, …) because esbuild retains a whole namespace once any member is touched. `pnpm check:bundle` bundles representative consumers with Rolldown and esbuild, executes them, and fails on byte budgets; `bench:hot` measures decoder and async CPU overhead with checksums.

### Decision 14: A faster decoder protocol, and `compile` as an opt-in

The interpreter allocates one `Result` per decode instead of per field, passes keys down instead of pushing them onto the path, fuses primitive refinements, and checks primitive fields inline from one descriptor per field. That is 1.2–1.5x and leaves it ~1.7x above the generic-loop floor. `D.compile` generates literal-key code for the structural subset (struct, array, record, taggedUnion, primitives with inline regex checks, optional, nullable, option, literal) and calls the interpreter for everything else, so it is equivalent by construction and property-tested as such; it is opt-in because it uses `new Function`, and it falls back to the interpreter where that is forbidden.

Also amended: `Async.retry` now requires `retriable`. Defaulting to "retry everything" was a foot-gun.

## Architecture

```
src/
├── result.ts        Result, constructors, map/andThen/match, all/traverse/validateAll/partition, fromThrowable
├── option.ts        Option with a shared `none`; boundary converters fromNullable/toNullable
├── brand.ts         Brand<T, Name> — compile-time nominal typing, zero runtime
├── tagged.ts        Tagged<Tag, Fields>, tagged() constructors, hasTag guards — the shape of every error and variant
├── match.ts         match / matchBy (exhaustive by type) and assertNever (the one sanctioned defect)
├── fn.ts            pipe, identity, constant
├── decode.ts        public decoder surface (D, two-track/decode) over:
├── decode-internal.ts   the protocol: Failure marker, inline primitive check, field/node metadata
├── decode-core.ts       primitives + fused refinements, brand, struct/array/record/taggedUnion/oneOf/json/lazy
├── decode-dates.ts      isoDate (strict), dateFromString (permissive, named so)
├── decode-compile.ts    D.compile: opt-in literal-key codegen, CSP fallback
├── capabilities.ts  Clock, Sleeper, Random, IdGen — system and deterministic implementations
├── async.ts         AsyncResult, fromPromise/tryPromise, mapConcurrent, validateConcurrent, retry/backoff, withTimeout
├── lanes.ts         trigger coordination: switchLane, exhaustLane, queueLane, debounce, throttle, semaphore
├── testing.ts       the `two-track/testing` entry: law and round-trip helpers that take fast-check as a parameter
└── index.ts         public surface: types + constructors at top level, everything else under R, O, D, Async, Cap, Lane
tools/
└── check/           `two-track-check` — a SEPARATE dev-time package (TypeScript 6 API) that checks apps for the foot-guns types cannot see
```

**Dependency direction is enforced, not described.** [`scripts/invariants.ts`](scripts/invariants.ts) holds a `LAYERS` table listing exactly which modules each module may import, and a new module that is not registered fails the build with a message telling you to register it and update [ARCHITECTURE.md](ARCHITECTURE.md). The layers, lowest first:

| Layer | Modules | May import |
|---|---|---|
| Core algebra | `result`, `brand`, `tagged`, `match`, `fn`, `capabilities` | nothing |
| Core algebra, derived | `option` | `result` |
| Boundary | `decode-internal`, `decode-core`, `decode-dates`, `decode-compile`, `decode` | `result`, `option`, `brand` (and each other, lowest first) |
| Shell | `async`, `lanes` | `async` → `result`, `capabilities`, `tagged`; `lanes` → those plus `async` |
| Test support | `testing` | `result`, `option`, `decode` |
| Surface | `index` | anything |

Nothing in `src/` imports from `node:`; the library is pure web-standard JavaScript (`Promise`, `AbortController`, `crypto.randomUUID`, `setTimeout`, and `new Function` only inside the opt-in `D.compile`, which probes for it once and falls back where it is forbidden) and runs unchanged in browsers and edge runtimes.

**Where your application code goes** is the subject of the companion skill, but the shape the library assumes is: `domain/` (types, decoders, pure functions, error definitions — synchronous, imports only `two-track`), `workflows/` (async functions over domain types and a capability record), `infra/` (implementations of the capability interfaces), and one `main` that builds the record and runs.

## API tour

Everything below is from the public surface and is exercised by the tests in [`test/`](test/) and the worked example in [`examples/checkout.ts`](examples/checkout.ts).

### Result: the railway

```ts
import { ok, err, R, type Result } from "two-track";

type ParseError = { readonly _tag: "ParseError"; readonly input: string };
const parseQty = (s: string): Result<ParseError, number> => {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? ok(n) : err({ _tag: "ParseError", input: s });
};

// Compose with combinators (one closure per step, ~2x baseline) ...
const total = R.map(R.andThen(parseQty("3"), (q) => ok(q * 199)), (cents) => cents / 100);

// ... or with early returns in hot paths (the baseline; this is what Rust's `?` compiles to)
const price = (s: string): Result<ParseError, number> => {
  const q = parseQty(s);
  if (!q.ok) return q;
  return ok(q.value * 199);
};

// Collections: first-error (traverse) vs every-error (validateAll) vs never-fail (partition)
R.traverse(["1", "2", "x"], parseQty);     // err(ParseError "x")
R.validateAll(["x", "2", "y"], parseQty);  // err([ParseError "x", ParseError "y"])
R.partition([ok(1), err("a")]);            // { oks: [1], errs: ["a"] }
R.all([ok(1), ok("a")] as const);          // Result<never, [number, string]> — tuple-typed

// The interop edge: the only try/catch in a codebase
R.fromThrowable(() => JSON.parse(text), (cause) => ({ _tag: "BadJson" as const, cause }));
```

The error type widens automatically as steps are chained: `R.andThen(a, f)` has error type `EA | EF`. The compiler therefore knows every failure mode that can reach a caller, and `match` over the error forces every one to be handled.

### Option: absence without null

```ts
import { some, none, O } from "two-track";

const first = O.find(users, (u) => u.active);        // Option<User>
const email = O.map(first, (u) => u.email);           // Option<Email>
O.unwrapOr(email, "nobody@example.com");
O.toResult(first, () => ({ _tag: "NoActiveUser" as const }));
O.fromNullable(row.deleted_at);                        // boundary only
```

`none` is a singleton; `O.map(none, f)` returns the same object and allocates nothing.

### Decoders: parse, don't validate

```ts
import { D, type Infer } from "two-track";

const Email = D.brand(D.pattern(/^[^\s@]+@[^\s@]+$/, "expected email"), "Email");
const Cents = D.brand(D.min(D.integer, 0), "Cents");

const PlaceOrder = D.struct({
  email: Email,
  lines: D.nonEmptyArray(D.struct({ sku: D.nonEmptyString, qty: D.min(D.integer, 1) })),
  coupon: D.option(D.nonEmptyString),   // null | undefined on the wire → Option in the domain
  note: D.optional(D.string),           // key may be absent → `note?: string`
});
type PlaceOrder = Infer<typeof PlaceOrder>;

const r = PlaceOrder.decode(await req.json());   // Result<DecodeError, PlaceOrder>
if (!r.ok) return respond(400, D.formatIssues(r.error));
// r.value.email is Brand<string, "Email">; nothing downstream re-checks it
```

```ts
// CPU-bound path decoding many valid objects? Compile it. Same semantics by construction
// (property-tested), literal-key code, 2–4x the interpreter; a no-op where new Function is forbidden.
const PlaceOrderFast = D.compile(PlaceOrder);
```

Decoders accumulate every issue in a struct or array with its path (`lines.1.qty: expected >= 1`), because boundaries should report all problems at once. The decoder is the smart constructor: `D.brand` is the one place a brand is applied, and it sits behind the checks that justify it. `D.taggedUnion("kind", {...})` decodes discriminated unions by picking the variant and reports only that branch's issues; `D.oneOf(...)` tries alternatives and, on failure, reports every alternative's issues prefixed `alternative N:`; `D.json` parses and decodes in one step; `D.lazy` handles recursive shapes; `D.custom` wraps any type guard. Names are contracts: `D.isoDate` accepts strict ISO-8601 only (date, or date-time with an offset) and rejects calendar-invalid dates, while `D.dateFromString` is the engine's permissive grammar under a name that says so.

### Tagged errors and exhaustive matching

```ts
import { tagged, match, assertNever, type Tagged } from "two-track";

const OrderNotFound = tagged("OrderNotFound")<{ orderId: OrderId }>();
const PaymentDeclined = tagged("PaymentDeclined")<{ reason: string; retriable: boolean }>();
type CheckoutError = ReturnType<typeof OrderNotFound> | ReturnType<typeof PaymentDeclined>;

const status = (e: CheckoutError): number =>
  match(e, {
    OrderNotFound: () => 404,
    PaymentDeclined: ({ retriable }) => (retriable ? 503 : 402),
  }); // adding a third error makes this a compile error until handled

// Or a switch, proven exhaustive by assertNever in the default
switch (e._tag) {
  case "OrderNotFound": return 404;
  case "PaymentDeclined": return 402;
  default: return assertNever(e);
}
```

`match` is a property lookup at runtime. There is no `default` option because a catch-all silently absorbs future variants, which is the bug exhaustive matching exists to prevent.

### The async railway

```ts
import { Async, Cap } from "two-track";

// Interop edge: a promise that may reject → a promise that never rejects, with a signal for cancellation
const fetchJson = (url: string, signal: AbortSignal) =>
  Async.tryPromise((s) => fetch(url, { signal: s }).then((r) => r.json()), (cause) => ({ _tag: "Network" as const, cause }), signal);

// Bounded, fail-fast fan-out: first error aborts in-flight work and stops launching more.
// Pass a `signal` and the union gains Aborted: a cancelled fan-out is a failure, never a sparse success.
const priced = await Async.mapConcurrent(lines, (line, _i, signal) => priceLine(line, signal), { concurrency: 8 });

// Accumulating fan-out for batch jobs
const report = await Async.validateConcurrent(rows, importRow, { concurrency: 16 });

// Retry only what is transient, with exponential backoff and jitter from an injectable Random.
// `retriable` is required. With a `signal`, an abort between attempts yields err(Aborted) and the
// error type widens to E | Aborted — so cancellation is visible in the signature, not guessed from the last error.
const charged = await Async.retry((attempt, signal) => gateway.charge(order, signal), {
  attempts: 5,
  delay: Async.backoff({ baseMs: 100, maxMs: 2_000, random: deps.random.next }),
  retriable: (e) => e._tag === "GatewayTimeout",
  sleeper: deps.sleeper,
  signal: request.signal,
});

// Deadlines that actually cancel
const result = await Async.withTimeout((signal) => fetchJson(url, signal), 5_000, () => ({ _tag: "Timeout" as const }));
```

### Capabilities

```ts
import { Cap } from "two-track";

type Deps = { readonly clock: Cap.Clock; readonly ids: Cap.IdGen; readonly orders: OrderRepo };

// production composition root
const deps: Deps = { clock: Cap.systemClock, ids: Cap.systemIdGen, orders: pgOrderRepo(pool) };

// tests
const testDeps: Deps = { clock: Cap.controlledClock(1_700_000_000_000), ids: Cap.sequentialIds("o-"), orders: inMemoryOrders() };
```

`Cap.seededRandom(seed)` is a Mulberry32 PRNG for deterministic jitter and sampling; `Cap.instantSleeper()` makes retry tests instant while recording every requested delay; `Cap.manualSleeper()` fires timers only when a test says so, which is how debounce is tested without real time.

### Lanes: what happens to the previous call

`mapConcurrent` fans out a known collection. Lanes answer a different question, the one UIs, HTTP handlers, webhooks and pollers ask: a new trigger arrived while the last operation is still running — what happens to the old one? These are the RxJS `switchMap` / `exhaustMap` / `concatMap` semantics as plain functions, with the outcomes on the error track where a handler must decide what they mean. They belong in the shell, never in the domain.

```ts
import { Lane, Cap } from "two-track";

// search-as-you-type: only the latest request may win; superseded calls resolve err(Superseded) at once
const search = Lane.switchLane((signal, q: string) => api.search(q, signal));

// a save button: ignore clicks while a save is in flight
const save = Lane.exhaustLane((signal, draft: Draft) => api.save(draft, signal));

// a webhook that must be processed in order, with back-pressure
const ingest = Lane.queueLane((signal, event: Event) => handle(event, signal), { depth: 100 });

// trailing-edge debounce and leading-edge throttle, timed through capabilities (deterministic in tests)
const suggest = Lane.debounce((signal, q: string) => api.suggest(q, signal), 250, { sleeper: Cap.systemSleeper });
const refresh = Lane.throttle((signal) => api.refresh(signal), 1_000, { clock: Cap.systemClock });

// bounded concurrency when you have neither a list nor a trigger
const db = Lane.semaphore(10);
const row = await db.run((signal) => repo.find(id, signal));
```

Each lane adds its failure mode to the returned union (`E | Superseded`, `E | Busy`, `E | QueueFull | Busy`), so a `match` at the edge is forced to say what a superseded search or a full queue looks like to the user.

Cost, measured (`pnpm bench:lanes`, Node 24): `queueLane`, `throttle` and `semaphore` add 0.5–2 µs per trigger; `switchLane` and `debounce` add ~10 µs on V8 (about 1.5 µs on Bun) because each trigger allocates a controller, a race and an abort dispatch. That is the right price for keystrokes, clicks and webhooks, and the wrong tool inside a per-row loop, where `Async.mapConcurrent` or a `semaphore` belongs. `pnpm check:lanes` fails if any lane exceeds a ratio gate against a same-run baseline.

### Testing helpers: laws in one line

`two-track/testing` ships the properties the library uses on itself. fast-check is passed in as the first argument and is never a dependency of the package.

```ts
import fc from "fast-check";
import { D, R } from "two-track";
import { arbDecoded, arbResult, decoderNeverThrows, decoderRoundTrip, functorLaws, monadLaws } from "two-track/testing";

const Email = D.brand(D.pattern(/^[^\s@]+@[^\s@]+$/), "Email");
const arbEmail = arbDecoded(fc, fc.emailAddress(), Email);

decoderRoundTrip(fc, Email, arbEmail);      // decode(a) == ok(a) for every generated a
decoderNeverThrows(fc, Email);               // for fc.anything()

// your own combinator over Result? prove it is still a lawful functor/monad
functorLaws(fc, { arb: arbResult(fc, fc.string(), fc.integer()), map: R.map });
monadLaws(fc, { arb: arbResult(fc, fc.string(), fc.integer()), of: R.ok, andThen: R.andThen }); // kleisli arrows derived
```

### The checker: the foot-guns types cannot see

Correctness here is checked, not enforced (see below), so the check has to be a tool rather than a document. `two-track-check` is a separate dev-time package in [`tools/check`](tools/check/) with its own dependencies (it needs TypeScript 6's compiler API; the library and your app stay on TypeScript 7). Every finding ends with the fix:

```
src/workflows/checkout.ts:41:3: [ignored-result] Result ignored — the error silently vanishes — fix: handle it: `const r = ...; if (!r.ok) return r;` or discard explicitly with `void` and a reason comment
src/domain/pricing.ts:12:34: [no-platform-calls] `Date.now()` outside infra/ — fix: take a Cap.Clock capability (deps.clock.now()) so the domain stays pure and testable
src/domain/order.ts:1:1: [layer-domain-imports] domain imports "pg" — fix: domain/ may import only [two-track]; drivers and frameworks belong in infra/, injected through ports
```

The type-aware must-use family — `ignored-result`, `floating-async-result`, `ignored-result-in-callback`, `floating-async-callback` — is the point of the package: it is TypeScript's missing `#[must_use]`, and it covers the cases a grep never could, such as a Result returned from a `forEach` callback or an array of Results produced by `map` and never read. Banned constructs, platform calls and `process.env` outside their layers, layer direction, brand forging, bare `Promise.all`, `fetch` without a signal, and `default:` without `assertNever` round it out, and `R.unwrapOr` / `D.unknown` are reported at `review` severity for a human to confirm. Suppressions require a reason (`allow-needs-reason`) and are counted. See the package README for usage, config and the full rule table.

## Public surface

Everything the package exports, so nothing is discoverable only by reading `dist/`. Namespaces are plain module objects; top-level names are the ones written constantly.

| Where | Exports |
|---|---|
| top level | `ok`, `err`, `unit`, `some`, `none`, `match`, `matchBy`, `assertNever`, `tagged`, `hasTag`, `pipe`, `identity`, `constant`; types `Result`, `Ok`, `Err`, `OkOf`, `ErrOf`, `NonEmptyArray`, `Option`, `Some`, `None`, `Brand`, `Unbrand`, `Tagged`, `TagOf`, `Cases`, `CasesBy`, `Decoder`, `DecodeError`, `DecodeIssue`, `Infer`, `StructOf`, `PathSegment`, `AsyncResult`, `ConcurrencyOptions`, `RetryPolicy`, `BackoffOptions`, `Clock`, `Sleeper`, `Random`, `IdGen` |
| `R` | `isOk`, `isErr`, `map`, `mapErr`, `mapBoth`, `andThen`, `orElse`, `match`, `unwrapOr`, `unwrapOrElse`, `tap`, `tapErr`, `flatten`, `swap`, `all`, `traverse`, `validateAll`, `partition`, `fromThrowable`, `fromPredicate`, `fromNullable` |
| `O` | `isSome`, `isNone`, `map`, `andThen`, `orElse`, `filter`, `match`, `unwrapOr`, `unwrapOrElse`, `fromNullable`, `toNullable`, `toUndefined`, `toResult`, `all`, `find` |
| `D` | primitives `unknown`, `string`, `number`, `integer`, `boolean`, `literal`, `custom`; refinements `refine`, `map`, `andThen`, `brand`, `pattern`, `nonEmptyString`, `trimmed`, `minLength`, `maxLength`, `min`, `max`; dates `isoDate` (strict), `dateFromString` (permissive); containers `nullable`, `option`, `optional`, `array`, `nonEmptyArray`, `record`, `struct`, `taggedUnion`, `oneOf`, `json`, `lazy`; `formatIssues`; `compile` |
| `Async` | `fromPromise`, `tryPromise`, `map`, `mapErr`, `andThen`, `orElse`, `match`, `tap`, `tapErr`, `all`, `mapConcurrent`, `validateConcurrent`, `retry`, `backoff`, `withTimeout`; `Aborted` |
| `Cap` | `systemClock`, `systemSleeper`, `systemRandom`, `systemIdGen`; deterministic `controlledClock`, `instantSleeper`, `manualSleeper`, `seededRandom`, `sequentialIds` |
| `Lane` | `switchLane`, `exhaustLane`, `queueLane`, `debounce`, `throttle`, `semaphore`; `Superseded`, `Busy`, `QueueFull` |
| `two-track/testing` | `arbResult`, `arbOption`, `arbDecoded`, `functorLaws`, `monadLaws`, `decoderRoundTrip`, `decoderNeverThrows`, `decoderDoesNotMutate`, `structuralEq`; types `FastCheckLike`, `Arb`, `Eq` |

Every module is also a subpath (`two-track/result`, `two-track/decode`, …) for selective bundling.

## Conventions

These are the rules the companion skill enforces on application code. The library itself follows all of them: [`scripts/invariants.ts`](scripts/invariants.ts) checks the ones that apply to `src/` (banned constructs, layer direction, file size, platform calls, double casts) on every build, and `two-track-check` is the tool that checks them in an application, including the type-aware ones.

**Errors**
- An error is `{ readonly _tag: "WhatHappened"; ...fields }` built with `tagged`. The tag says what happened (`OrderNotFound`), not who threw (`DbError`). Fields carry what a handler needs: ids, the offending value, `retriable`. Never a bare message string.
- Every public function's error type is a union of named tags. Never `Error`, `unknown`, or `string`.
- Infrastructure errors are translated to domain errors at the capability boundary. A driver's error type never appears in a workflow signature.
- Handle errors where you have the context to act, usually at the edge (HTTP handler, CLI command, queue consumer). Mid-pipeline code lets them flow past.
- `assertNever` is the only sanctioned `throw`: it marks a state the types prove impossible. Reaching it is a bug at a boundary, not an expected error.

**Boundaries**
- Decode at every boundary with a `Decoder`, once. Zero `as` casts on external data. The brand is applied by `D.brand` and nowhere else.
- Accumulate at boundaries (`D.struct`, `R.validateAll`, `Async.validateConcurrent`); fail fast inside sequential workflows (`R.andThen`, `R.traverse`, `Async.mapConcurrent`).
- Wire shape and domain shape are different types. Separate decoders per boundary when they differ (`UserRow`, `UserResponse`, `User`).

**Purity and effects**
- The domain is synchronous. It does not call `Date.now`, `Math.random`, `crypto.randomUUID`, `fetch`, or `setTimeout`; it receives a capability or the value.
- Workflows are `async` functions returning `AsyncResult`, taking a capability record as their first argument. They may `await`; they never `throw`, `try`, or `.catch`.
- The only `try/catch` and the only `.catch` in a codebase are inside `R.fromThrowable`, `Async.fromPromise`, and `Async.tryPromise` calls at the interop edge, each converting to a tagged error.
- Exactly one composition root builds the production capability record.

**Types**
- `readonly` on every field, `ReadonlyArray` for every collection, `as const` for literals. No `let` at module scope, no mutating methods (`push`, `splice`, `sort` in place) on data that escapes a function.
- No `null` or `undefined` in domain types; use `Option`. `optional` fields exist only in decoders for wire shapes.
- No boolean flags encoding state machines; use a tagged union with per-state data.
- No naked `string`/`number` for ids, money, quantities; use brands produced by decoders. Money is integer minor units.
- No `any`, no non-null assertions, no `@ts-ignore`. Strict flags on: `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`.

**Performance**
- In code called per element: early returns, no closures, no spread, no `Object.freeze`, no generators. Combinators (`R.andThen`) are fine everywhere else.
- Every fan-out has an explicit `concurrency`. Every external call has a timeout. Retries are transient-only with backoff and jitter.
- Keep JSON round trips out of the process; they cost more than any railway.

**Testing**
- Pure domain functions: unit tests and fast-check properties, no fakes. Most tests live here.
- Workflows: fakes as plain objects implementing the capability interfaces, `controlledClock`, `instantSleeper`, `seededRandom`.
- Laws are tests: every custom combinator has functor/monad law properties; every decoder has a round-trip property; every fan-out has a peak-concurrency assertion.
- Error tracks are API surface. Test them, including "a failure leaves no partial state".

## Tradeoffs: what you give up

Stated plainly, because a library that hides its limits is a library that gets misused.

| You give up | Because | What replaces it |
|---|---|---|
| A requirements channel (`R` in `Effect<A, E, R>`) | No runtime to resolve it | Capability record as the first argument; one composition root; lint that the domain imports nothing else |
| Do-notation (`yield*`) | 40–80x measured cost | Early returns in the domain, `await` + `Async.andThen` in the shell |
| Fibers, interruption, structured concurrency | No runtime | `AbortSignal` threaded through every async combinator; `mapConcurrent` aborts in-flight work on first failure; `Lane.*` for switch/exhaust/queue semantics |
| Schemas that double as test generators | No schema runtime | fast-check arbitraries written beside each decoder, with a round-trip property tying them together |
| Nominal types | TypeScript is structural | Brands applied only inside decoders; `two-track-check`'s `no-brand-cast` rejects `as Brand<` and casts to branded types outside the configured `brandFiles` |
| Enforced purity | The compiler cannot see effects | Capabilities by convention, plus `two-track-check`'s `no-platform-calls`, `no-process-env` and `no-console` outside `infra/` |
| Higher-kinded abstraction (one `map` over Result, Option, Array) | TypeScript has no HKTs; neither does Rust | Concrete `R.map`, `O.map`, `Array.prototype.map` |
| Runtime immutability | 10–20x measured cost of `Object.freeze` | `readonly` types; freeze fixtures in tests only |
| Automatic retries, caching, metrics, tracing | Not a runtime concern this library owns | Thin helpers (`Async.retry`, `withTimeout`); observability belongs to your shell |

Compared with **neverthrow**: same idea, similar speed for the fluent style, but neverthrow ships classes with methods (2–3x) and `safeTry` generators (80x) as the recommended idioms, and it has no decoders, capabilities, or concurrency helpers. Compared with **Effect**: Effect gives you everything in the left column above, with a correctness story this library cannot match, at ~100x on CPU-bound paths and with a learning curve; choose Effect when the dependency graph, concurrency, or interruption semantics are the hard part of your system. Compared with **Rust**: Rust enforces what this library can only check; choose Rust when the compiler must be the gatekeeper or when throughput matters more than the JavaScript ecosystem. Compared with **Ramda**: Ramda is a transformation vocabulary, not a railway, and its currying costs 20x; this library does not support point-free style on purpose.

## Is this real functional programming?

Mostly yes, with two honest qualifications: the algebra is real but structurally typed and erased, and the enforcement is weaker than Rust's.

What defines FP — purity, immutability, totality, algebraic data types, composition — is all present. `Result` and `Option` are true sum types; `readonly` records are true product types; `match` with a `never` check is compile-time coverage checking, which TypeScript does better than almost any mainstream language; a function from input to `Result` is total and composes through `andThen`. Writing `if (!r.ok) return r` instead of calling a bind combinator does not change the semantics; Rust's `?` is exactly that early return, and the F# railway's `bind` inlines to it. Point-free style is a notation, not the definition.

The gaps are structural typing (a brand can be forged with a cast; Rust's newtype cannot), erasure (a value from a wire that lies about its shape passes through typed code, which is why decoders are mandatory at every boundary), and the absence of higher-kinded types and effect tracking. TypeScript is also deliberately unsound in places; the strict flags close most of it.

So the honest verdict: **checked FP rather than enforced FP.** The compiler verifies the algebra as long as nobody casts, lint and review hold the purity line, and the laws are proven by property tests. If you want the compiler to enforce instead of check, that is Rust. If you want effects in the types within TypeScript, that is Effect, at the cost measured above.

## Harness engineering: how this repository is organized

This repository is built to be worked on by coding agents with humans steering, following the practices in OpenAI's [harness engineering](https://openai.com/index/harness-engineering/) write-up. The concrete consequences:

- **[AGENTS.md](AGENTS.md) is a map, not a manual.** About a hundred lines: what the repo is, the non-negotiables, the commands, and where to look next. [CLAUDE.md](CLAUDE.md) imports it so Claude Code and other agents share one entry point.
- **[ARCHITECTURE.md](ARCHITECTURE.md)** is the top-level map of modules, layers, and the permitted dependency edges, kept in sync with the `LAYERS` table in the linter.
- **`docs/` is the system of record.** [Design docs](docs/design-docs/index.md) hold the [core beliefs](docs/design-docs/core-beliefs.md) and one decision record per non-obvious choice, each with its evidence. [Execution plans](docs/exec-plans/) are checked in with progress and decision logs; completed plans stay as history; [tech debt](docs/exec-plans/tech-debt-tracker.md) is tracked next to them. [QUALITY_SCORE.md](docs/QUALITY_SCORE.md) grades each module and names the gaps. [References](docs/references/) hold the benchmark results with their method.
- **Invariants are enforced mechanically, with remediation in the message.** [`scripts/invariants.ts`](scripts/invariants.ts) checks zero runtime dependencies, banned constructs, layer direction, file size, that every markdown link resolves, that every decision is indexed, and that every active plan has the required sections. Every violation message ends with "fix: …" because the reader is usually an agent that will apply it without further context. The same checks run as a structural test so `pnpm test` fails on drift.
- **Performance is an invariant, not a hope.** `pnpm bench:check` fails if the library's combinators exceed 4x the inline baseline.
- **Time-dependent code is property-tested, and that is enforced.** Every export of `async`, `lanes` and `capabilities` must appear in its `*.properties.test.ts`, where fast-check drives generated event sequences over `manualSleeper` and `controlledClock` and checks leaks (no pending timers, no abort listeners). A downstream consumer found the retry cancellation bug that this now catches; the write-up is in [docs/exec-plans/completed/0002-downstream-findings.md](docs/exec-plans/completed/0002-downstream-findings.md).
- **Progressive disclosure.** An agent starts at AGENTS.md, is pointed to ARCHITECTURE.md and the decision index, and reads a reference only when working in that area.
- **The companion skill is the taste layer.** [two-track-fp-skill](https://github.com/mikezupper/two-track-fp-skill) encodes how application code built on this library should look, with its own hard rules, decision tables, anti-pattern lists, and a mandatory self-review pass.

## Development

```bash
pnpm install          # dev dependencies only; the library has none
pnpm check            # typecheck + invariants + coverage + bench:check + check:lanes + build + check:bundle + check:package + check:tools
pnpm test             # vitest: unit, property (fast-check), structural (invariants), example
pnpm test:coverage    # library + invariant coverage; enforces per-file minimums
pnpm typecheck        # tsc 7, every strict flag
pnpm lint             # scripts/invariants.ts — architecture and taste, with fixes in the messages
pnpm bench            # bench/encodings.ts — the encoding table above, on your machine
pnpm bench:check      # same, failing if combinators exceed 4x the inline baseline
pnpm bench:hot        # decoder throughput and async overhead, with checksums
pnpm bench:bundle     # representative minified/gzip/Brotli consumers, Rolldown and esbuild
pnpm check:bundle     # consumer runtime smoke checks + bundle byte budgets (after build)
pnpm example          # examples/checkout.ts — the worked workflow end to end
pnpm build            # emits dist/ with declarations and source maps
pnpm check:tools      # two-track-check: typecheck, tests with coverage, build and self-check (also in check)
pnpm check:package    # pack + install + import/require + tsc (TS 6 and 7, skipLibCheck false) as a consumer would
pnpm check:lanes      # lane throughput ratio gates against a same-run baseline
pnpm bench:lanes      # the lane table without gates
pnpm bench:cross      # decoders vs Zod/Valibot/ArkType, railway vs Ramda/Effect (report only; workspace bench/cross)
```

Scripts, benchmarks, and examples are plain `.ts` files run directly by Node 22.18+ through native type stripping; the code uses only erasable syntax (`erasableSyntaxOnly` is on) so no transpiler is needed anywhere in the toolchain.

The definition of done for any change is `pnpm check` green, the relevant decision record updated or added, and the quality score adjusted if a grade changed. See [CONTRIBUTING.md](CONTRIBUTING.md) for the agent loop.

## Installation and compatibility

```bash
pnpm add two-track            # once published (release workflow: tag v* → npm trusted publishing with provenance)
pnpm add github:mikezupper/two-track   # until then
```

For the smallest bundles across bundlers, import just the functions you use from a module subpath:

```ts
import { ok, andThen } from "two-track/result";
import { struct, integer, nonEmptyString } from "two-track/decode";
import { mapConcurrent } from "two-track/async";
```

All library modules have subpaths (`result`, `option`, `brand`, `tagged`, `match`, `fn`, `decode`, `async`, `capabilities`, `lanes`, `testing`). Root namespaces remain available. The compiler and runtime consumer checks cover both import styles.

**Consumer requirements** (what `dist/` needs) are deliberately looser than **contributor requirements** (what developing this repo needs):

| | Consumer | Contributor |
|---|---|---|
| Runtime | any ES2023 engine with `Promise`, `AbortController`, `crypto.randomUUID`, `setTimeout`; Node ≥ 20, Bun, Deno, browsers, edge workers | Node ≥ 22.18 (runs `.ts` scripts via native type stripping) |
| TypeScript | 6.0+ verified with `skipLibCheck: false`; 5.x expected to work (the types use `const` type parameters) | 7.0 (the compiler used for `typecheck` and `build`) |
| Module format | ESM with `default` conditions, so `require("two-track")` works on Node ≥ 22.12 via `require(esm)`; `two-track/package.json` is exported | — |

`pnpm check:package` proves this on every change: it packs the tarball, installs it in a scratch project, imports and requires it, and compiles a consumer with `skipLibCheck: false` under TypeScript 6 and TypeScript 7.

- **Tree-shaking:** `sideEffects: false`; namespaces are plain module objects.
- **Versioning:** semver once published. The encoding of `Result` and `Option` (field names `ok`/`value`/`error` and `some`/`value`) is part of the public contract and will not change in a minor version, because user code narrows on it directly.

## Sources and credits

- **Scott Wlaschin — [F# for Fun and Profit](https://fsharpforfunandprofit.com)**: [Railway Oriented Programming](https://fsharpforfunandprofit.com/rop/) · [Designing with Types](https://fsharpforfunandprofit.com/series/designing-with-types/) · [A Recipe for a Functional App](https://fsharpforfunandprofit.com/series/a-recipe-for-a-functional-app/) · [Property-Based Testing](https://fsharpforfunandprofit.com/series/property-based-testing/)
- **Alexis King — [Parse, Don't Validate](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/)**
- **Ryan Lopopolo (OpenAI) — [Harness engineering](https://openai.com/index/harness-engineering/)** for the repository organization
- **neverthrow, Effect, Ramda, fp-ts** for prior art and for being the comparison rows in the benchmark

*This library encodes one person's opinionated synthesis; none of the authors above endorse it.*

## License

[MIT](LICENSE) © 2026 Mike Zupper.
