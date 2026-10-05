# Benchmarks — method and recorded results

All results: Linux workstation, best-of-N wall time, `performance.now()`, three-step railway (parse quantity → price → discount) over 1,000,000 items with a 10% failure rate. Node v24.15.0, Bun 1.3.14. Numbers vary ±10% run to run; ratios are stable. Re-run with the commands given before changing any table in the README.

## Encodings (`pnpm bench`, `bench/encodings.ts`)

Recorded 2026-10-05.

| Encoding | Node 24 | Bun 1.3 |
|---|---|---|
| inline two-shape objects (baseline) | 12.7 ms | 11.5 ms |
| two-track `R.andThen` combinators | 24.2 ms | 18.5 ms |
| throw / try-catch | 340.7 ms | 57.0 ms |
| `Object.freeze` every result | 115.6 ms | 194.2 ms |
| generator do-notation (not shipped) | 969.0 ms | 463.7 ms |
| **combinators / baseline** | **1.91x** | **1.60x** (limit 4x) |

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
