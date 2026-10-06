# Benchmarks — method and recorded results

Runtime measurements use a Linux workstation, best-of-N wall time and `performance.now()`. The encoding and cross-library workloads are a three-step railway (parse quantity → price → discount) over 1,000,000 items with a 10% failure rate. Node v24.15.0, Bun 1.3.14. Numbers vary ±10% run to run; ratios are more stable. Re-run with the commands given before changing any table in the README. Decoder/async workloads and consumer bundle methods are described below.

## Encodings (`pnpm bench`, `bench/encodings.ts`)

Recorded 2026-10-05.

| Encoding | Node 24 | Bun 1.3 |
|---|---|---|
| inline two-shape objects (baseline) | 12.8 ms | 11.5 ms |
| two-track `R.andThen` combinators | 22.9 ms | 18.5 ms |
| throw / try-catch | 345.4 ms | 57.0 ms |
| `Object.freeze` every result | 118.7 ms | 194.2 ms |
| generator do-notation (not shipped) | 1002.3 ms | 463.7 ms |
| **combinators / baseline** | **1.79x** | **1.60x** (limit 4x) |

Node results are from the complete review check; Bun results retain the earlier run on the same date.

## Encoding candidates considered for decision 0001

Recorded 2026-10-05 from the exploratory script (same workload; reproduced by `bench/encodings.ts` for the rows it includes).

| Encoding | Node 24 | Bun 1.3 |
|---|---|---|
| A. two shapes `{ok,value}` / `{ok,error}` | 11.7 ms | 10.5 ms |
| B. one monomorphic shape `{ok,value,error}` | 21.5 ms | 13.5 ms |
| C. `_tag: "Ok"|"Err"` two shapes | 23.7 ms | 14.9 ms |
| D. class + fluent `.andThen` (closures) | 34.9 ms | 24.1 ms |
| E. generator do-notation (`safeTry`) | 970.4 ms | 488.2 ms |
| F. Go tuple `[err, value]` | 18.3 ms | 13.2 ms |
| G. A + `Object.freeze` every result | 123.3 ms | 212.7 ms |
| H. A + singleton `Err`, inline steps | 16.5 ms | 26.8 ms |

Row H is within noise of A; the singleton is kept for `none`/`unit` because it is free, not because it is faster.

## Decoders versus Zod, Valibot and ArkType (`pnpm bench:cross` → `bench/cross/decoders-vs.mjs`)

Recorded 2026-10-06 after the decoder protocol rewrite and `D.compile` (decision 0014). Identical schema in all libraries (id pattern, email pattern, integer 0–150, array of non-empty strings, nested address with a zip pattern, optional boolean); each library's non-throwing API; best of 7; every library agrees on which objects are valid (asserted; 180,000 of 200,000) and reports exactly two issues on the two-error object. Versions pinned in `bench/cross/package.json`: zod 4.6.5, valibot 1.5.0, arktype 2.2.7. ArkType uses the same email regex as the others rather than its stricter built-in.

| Library | Node 24: 200k valid | 200k with 10% invalid | 50k from JSON text | ns / valid object | Bun 1.3: valid | 10% invalid | JSON | ns / valid |
|---|---|---|---|---|---|---|---|---|
| two-track 0.1.0 (interpreter) | 140 ms | 140 ms | 80 ms | 699 | 67 ms | 68 ms | 59 ms | 335 |
| two-track 0.1.0 `D.compile` | **60 ms** | **62 ms** | 56 ms | **299** | 35 ms | **36 ms** | 50 ms | 173 |
| zod 4.6.5 | 176 ms | 215 ms | 96 ms | 881 | 131 ms | 157 ms | 75 ms | 657 |
| valibot 1.5.0 | 209 ms | 215 ms | 99 ms | 1045 | 133 ms | 143 ms | 82 ms | 665 |
| arktype 2.2.7 | **43 ms** | 267 ms | **52 ms** | **213** | **32 ms** | 171 ms | 51 ms | **160** |

Reading: the interpreter is 20–35% faster than Zod and Valibot and the fastest interpreter when input is partly invalid. Compiled two-track is within 1.4x of ArkType on valid input on Node and within 8% on Bun, 4x faster than ArkType when 10% of the input is invalid (its issue objects are cheap), and at parity on the JSON-text path, where `JSON.parse` dominates. The previous recording (2026-10-05, before the rewrite): interpreter 855 ns on Node, 3.7x behind ArkType.

Follow-up, 2026-10-06 (same day, later): with `taggedUnion`/`record` compiled natively and `pattern` regexes tested inline, two back-to-back runs on a loaded machine gave interpreter 780–801 ns, compiled 320 ns, ArkType 231–237 ns — compiled/ArkType 1.35–1.38x (was 1.40x). Absolute numbers drift with machine load; the within-run ratio is the comparable figure.

## Decoder floor and A/B (`node _ab.ts`-style interleaved runs, 2026-10-06)

Same-process, interleaved, best of 9 over 200k objects; this is the measurement that decided decision 0014.

| Case | Old interpreter | New interpreter | Compiled |
|---|---|---|---|
| bench schema, valid | 730 ns | 615 ns (1.19x) | 263 ns (2.8x) |
| bench schema, 10% invalid | 783 ns | 698 ns (1.12x) | 298 ns (2.6x) |
| same schema with the three regexes removed | 576 ns | 484 ns (1.19x) | 121 ns (4.8x) |
| flat four-primitive struct | 219 ns | 166 ns (1.32x) | 55 ns (4.0x) |

The floor that explains the shape of these numbers (four-field object, Node 24): a hand-written generic loop over a key array, `obj[key]` + `typeof` + `out[key] =`, takes **94 ns**; the same checks written with literal keys take **13 ns**; literal keys returning the input object (no output allocation) take **10 ns**. Generic keyed property access is the interpreter's floor; literal keys need code generation; not allocating an output means aliasing the input and leaking undeclared keys, which two-track does not do.

## Railway versus Ramda and Effect (`pnpm bench:cross` → `bench/cross/railway-vs.mjs`)

Recorded 2026-10-05 against the built `dist/` with ramda 0.32.0 and effect 4.0.1 (same 1M-item, 3-step workload as `bench/encodings.ts`; best of 5).

| Approach | Node 24 | Bun 1.3 |
|---|---|---|
| plain discriminated union (baseline) | 10.1 ms | 7.2 ms |
| two-track `R.andThen` combinators (dist) | 30.4 ms (3.0x) | 16.6 ms (2.3x) |
| throw / try-catch | 434.9 ms | 63.4 ms |
| Ramda `pipeWith(R.chain)` + Fantasy Land Result | 319.2 ms | 244.4 ms |
| Ramda idiomatic point-free (`ifElse`/`converge`/`when`/`__`) | 619.6 ms | 553.1 ms |
| Effect `Effect.gen` + `runSync` per item | 2391.8 ms | 1409.8 ms |
| Effect `Effect.forEach` batched, one `runSync` | 1918.6 ms | 1268.7 ms |

The combinator ratio here (3.0x on Node) is higher than `bench:check`'s ~1.8x: this script measures the built `dist/` with a 5-rep best-of, the gate measures source with 7 reps. Both are under the 4x gate; the gap is run-to-run and build-form variance, not a regression.

The earlier numbers from the first exploratory script (2026-10-05, same day, different harness: plain 11.0, throw 296.6, Ramda 238.5 / 513.9, Effect 1923.2 / 1631.1 ms on Node) are superseded by the table above, which is reproducible from the repository.

## Lane throughput (`pnpm bench:lanes`, `pnpm check:lanes` enforces ratio gates)

Recorded 2026-10-05, Node 24.15.0, best of 5. Two workloads: *immediate* (200k triggers whose run resolves at once — pure coordination overhead) and *waiting* (20k triggers whose runs are settled FIFO after the burst — pending-state bookkeeping). Ratios are against calling the run directly with a fresh signal, measured in the same process, so the `--check` gates (immediate ≤ 75x, waiting ≤ 100x) hold across machines. Each row self-verifies its ok-count against the lane's semantics and its leak condition.

| Lane | Immediate ns/trigger | ratio | Waiting ns/trigger | ratio | Heap retained per pending call |
|---|---|---|---|---|---|
| baseline (direct call) | ~275 | 1.0x | ~195 | 1.0x | 481 B |
| `exhaustLane` | ~190 | 0.7x (199,999 of 200k return the shared `Busy`) | ~195 | 1.0x | 296 B |
| `queueLane` (depth ∞) | ~745 | 2.7x | ~480 | 2.5x | 304 B |
| `throttle` (controlledClock) | ~855 | 3.1x | ~545 | 2.8x | 1,105 B |
| `semaphore(16).run` | ~1,980 | **7.2x** | ~1,610 | 8.3x | 2,262 B |
| `debounce` (instantSleeper) | ~7,500 | 27x | ~6,560 | 34x | 2,189 B |
| `switchLane` | ~9,600 | 36x | ~9,530 | 49x | 2,225 B |

Bun 1.3.14 ratios: switch 9.7x / 9.2x, debounce 5.9x / 5.8x, queue 2.4x / 2.2x, throttle 1.8x / 1.6x, exhaust 0.5x / 0.4x, semaphore 5.3x / 4.5x.

Two findings came out of this bench:

- **`semaphore` was quadratic on V8 with a large waiting queue** (376x the baseline, 77–106 µs per trigger, ~20 s for 200k triggers; Bun was unaffected). `release()` used `Array.shift()` and the abort path `indexOf`+`splice`; V8 left-trims only small arrays. The queue is now a head-index FIFO with tombstoned aborts and periodic compaction: 7x, ~2 µs per trigger. A test pins the linear drain (`test/defects.test.ts`).
- **`switchLane` and `debounce` cost ~10 µs per trigger on V8** (6–10x less on JavaScriptCore). Each trigger allocates an `AbortController`, links a listener, builds a `Promise.race` with its own abort listener, and dispatches an abort to the previous call. That is the price of their semantics and it is fine for user-rate events (keystrokes, clicks, webhooks); it is the wrong tool inside a per-row loop, where `mapConcurrent` or a `semaphore` belongs. Documented in the README's lanes section.

## Rust / WASM (external to this repo; method recorded here)

A `cdylib` built with `cargo build --release --target wasm32-unknown-unknown`, no `wasm-bindgen`, exporting `run_batch(n)` over a static i32 buffer and `run_one(qty, price)`; loaded with `WebAssembly.instantiate`. Native: the same `railway()` in a release binary.

| Approach | Node 24 | Bun 1.3 |
|---|---|---|
| WASM batched (copy in + 1 call), integer args | 4.2 ms | 3.4 ms |
| WASM per-item call (1M crossings), integer args | 8.3 ms | 4.2 ms |
| native Rust `Result` + `?` | 1.5 ms | — |
| `JSON.stringify` + `JSON.parse` of 1M `{sku, qty, price}` objects (boundary floor for real data) | 438.9 ms | — |
| `JSON.stringify` + UTF-8 encode only (one direction) | 189.0 ms | — |

Interpretation: the integer-only WASM rows flatter WASM. Real domain data is objects and strings; serializing them costs 40x the entire JavaScript railway. WASM pays off for CPU-heavy pure kernels over binary-friendly data called in batches, and the typed error track does not cross `wasm-bindgen` (a Rust `Err` becomes a thrown JS exception).

## Decoder and async overhead (`pnpm bench:hot`)

Recorded 2026-10-05. [The benchmark](../../bench/hot-paths.ts) uses preconstructed inputs, checksums and the best of seven runs. Compare compiled snapshots with `node bench/hot-paths.ts --dir /path/to/dist`; both columns below used the same script and compiled modules. The before snapshot includes the review's correctness fixes, so this comparison isolates the subsequent performance changes.

| Workload | Before | After | Interpretation |
|---|---|---|---|
| struct, 200,000 items | 21.82 ms | 22.22 ms | within noise (2026-10-05); after decision 0014 (2026-10-06, best of several noisy runs): 16.1 ms interpreted, **3.2 ms with `D.compile`** on Node; 6.2 / 2.4 ms on Bun |
| array of structs, 200,000 items | 19.00 ms | 19.45 ms | within noise |
| `oneOf`, first alternative succeeds, 200,000 items | 27.02 ms | 22.15 ms | about 18% faster; no eager fallback allocation |
| array, 200,000 invalid integers | 9.15 ms | 6.99 ms | about 24% faster; indexed issue accumulation |
| `mapConcurrent`, 2,000 × 40 immediate callbacks | 10.25 ms | 9.74 ms | within noise |
| `validateConcurrent`, 2,000 × 40 immediate successes | 9.82 ms | 8.97 ms | about 9% faster; direct output writes, lazy error storage |
| semaphore, 20,000 immediate calls | 9.99 ms | 9.86 ms | within noise; signal linking uses fewer temporary arrays |

These are local CPU and allocation measurements, not network latency improvements. Failure-heavy concurrent validation still needs error storage. Timing is report-only; the existing encoding ratio remains the runtime performance gate. A separate regression proves nested decoding returns 300,000 accumulated issues without exceeding the engine's call-argument limit.

## Consumer bundles

Recorded 2026-10-06 (after decision 0014) with pinned Rolldown 1.2.12 and esbuild 0.28.0. Run `pnpm build && pnpm bench:bundle`. [The script](../../bench/bundles.mjs) bundles small consumer programs as minified ESM, uses the package's normal side-effect metadata, measures raw/gzip/Brotli output, and executes each emitted program to verify behavior. `pnpm check:bundle` enforces budgets for direct imports and full-surface/testing consumers under both bundlers.

esbuild retains namespace members through the root entry. Additive module subpaths let consumers select individual exports:

| Consumer | esbuild root namespace | esbuild direct subpath | Direct gzip | Rolldown direct |
|---|---|---|---|---|
| Result `ok` + `err` + `andThen` | 1,551 B | 117 B | 116 B | 114 B |
| struct decoder | 10,590 B | 2,300 B | 1,108 B | 2,286 B |
| primitive decoder | 10,545 B | 1,038 B | 542 B | 1,026 B |
| async interop | 3,280 B | 170 B | 150 B | 176 B |
| concurrent map | 3,274 B | 733 B | 444 B | 744 B |
| switch lane | 2,929 B | 731 B | 385 B | 769 B |

Selective consumers are 75–93% smaller through direct imports: `import { ok, err, andThen } from "two-track/result"`, `import { struct, nonEmptyString, integer } from "two-track/decode"`. The root API remains available. The root-namespace rows grew with the decoder rewrite and `compile` because a namespace import retains the whole module; the direct rows are what a selective consumer pays.

Before (2026-10-05, pre-0014, for the record): esbuild direct struct decoder 1,124 B, primitive 304 B, interop 170 B, concurrent 642 B, switch 731 B; Rolldown direct struct 1,119 B, primitive 301 B. The decoder protocol rewrite (value-or-Failure, inline primitive checks with their messages, struct field descriptors) cost about 1 kB on decoder consumers and bought 1.2–1.5x interpreter speed; `compile` is not retained unless imported (verified with esbuild: no `new Function` in a struct-only consumer).

Consumers retaining every runtime export: 20,696 B / 7,225 B gzip (Rolldown) and 20,472 B / 7,341 B gzip (esbuild) as of 2026-10-06, up from 13,764 / 13,510 B at the 2026-10-05 review (strict `isoDate`, `oneOf` reporting every alternative, the decoder protocol, and `compile` itself account for the difference). The `full` budget is 22,500 B and `decoderDirect` 2,500 B, `primitiveDirect` 1,150 B — regression tripwires set ~10% above these measurements. `two-track/testing` remains separate at about 1.5 kB minified. Both bundlers are development dependencies; the library has zero runtime dependencies.
