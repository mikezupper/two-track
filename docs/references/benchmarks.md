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

## Cross-library (`bench/cross-library.mjs`; needs `pnpm add -D ramda effect` temporarily)

Recorded 2026-10-05 with ramda 0.32.0 and effect 4.0.1.

| Approach | Node 24 | Bun 1.3 |
|---|---|---|
| plain discriminated union (baseline) | 11.0 ms | 11.0 ms |
| throw / try-catch | 296.6 ms | 78.9 ms |
| Ramda `pipeWith(R.chain)` + Fantasy Land Result | 238.5 ms | 220.7 ms |
| Ramda idiomatic point-free (`ifElse`/`converge`/`when`/`__`) | 513.9 ms | 518.7 ms |
| Effect `Effect.gen` + `runSync` per item | 1923.2 ms | 968.7 ms |
| Effect `Effect.forEach` batched, one `runSync` | 1631.1 ms | 1143.7 ms |

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
| struct, 200,000 items | 21.82 ms | 22.22 ms | within noise |
| array of structs, 200,000 items | 19.00 ms | 19.45 ms | within noise |
| `oneOf`, first alternative succeeds, 200,000 items | 27.02 ms | 22.15 ms | about 18% faster; no eager fallback allocation |
| array, 200,000 invalid integers | 9.15 ms | 6.99 ms | about 24% faster; indexed issue accumulation |
| `mapConcurrent`, 2,000 × 40 immediate callbacks | 10.25 ms | 9.74 ms | within noise |
| `validateConcurrent`, 2,000 × 40 immediate successes | 9.82 ms | 8.97 ms | about 9% faster; direct output writes, lazy error storage |
| semaphore, 20,000 immediate calls | 9.99 ms | 9.86 ms | within noise; signal linking uses fewer temporary arrays |

These are local CPU and allocation measurements, not network latency improvements. Failure-heavy concurrent validation still needs error storage. Timing is report-only; the existing encoding ratio remains the runtime performance gate. A separate regression proves nested decoding returns 300,000 accumulated issues without exceeding the engine's call-argument limit.

## Consumer bundles

Recorded 2026-10-05 with pinned Rolldown 1.2.12 and esbuild 0.28.0. Run `pnpm build && pnpm bench:bundle`. [The script](../../bench/bundles.mjs) bundles small consumer programs as minified ESM, uses the package's normal side-effect metadata, measures raw/gzip/Brotli output, and executes each emitted program to verify behavior. `pnpm check:bundle` enforces budgets for direct imports and full-surface/testing consumers under both bundlers.

esbuild retains namespace members through the root entry. Additive module subpaths let consumers select individual exports:

| Consumer | esbuild root namespace | esbuild direct subpath | Direct gzip |
|---|---|---|---|
| Result `ok` + `err` + `andThen` | 1,551 B | 117 B | 116 B |
| struct decoder | 4,279 B | 1,124 B | 631 B |
| primitive decoder | 4,234 B | 304 B | 223 B |
| async interop | 3,102 B | 170 B | 150 B |
| concurrent map | 3,096 B | 642 B | 399 B |
| switch lane | 2,744 B | 731 B | 385 B |

These selective consumer bundles are 74–95% smaller through direct imports. For example, use `import { ok, err, andThen } from "two-track/result"` or `import { struct, nonEmptyString, integer } from "two-track/decode"`. The existing root API remains available.

Rolldown already prunes the root namespaces effectively. Its direct consumers measure 114 B for Result, 1,119 B for the struct decoder, 301 B for a primitive decoder, 176 B for interop, 653 B for concurrent map and 769 B for switch lane. Pure annotations on inert decoder constructors reduce the struct consumer from 1,324 B before optimization to 1,119 B.

Consumers retaining every runtime export measure 13,764 B / 4,756 B gzip with Rolldown and 13,510 B / 4,843 B gzip with esbuild. The full-surface bundle did not materially shrink; correctness fixes and added guards offset local savings. `two-track/testing` remains separate at about 1.5 kB minified. Both bundlers are development dependencies; the library has zero runtime dependencies.
