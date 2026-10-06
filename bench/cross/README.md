# bench/cross — third-party comparison benchmarks

A private workspace (`two-track-bench-cross`) holding the benchmarks that need other libraries installed. It is separate so the library root keeps **zero runtime dependencies** and a small `pnpm install`; Effect, Ramda, Zod, Valibot and ArkType are devDependencies of this folder only.

```bash
pnpm build                                  # the scripts measure the built dist, not src
pnpm --filter two-track-bench-cross bench   # both scripts
node bench/cross/decoders-vs.mjs --json     # machine-readable
```

| Script | Measures | Rows |
|---|---|---|
| `decoders-vs.mjs` | Decoder throughput on one identical schema (regex id/email/zip, bounded integer, non-empty strings, nested struct, optional boolean): 200k valid objects, 200k with 10% carrying two field errors (accumulate-all behaviour), 50k JSON strings (the JSON floor). Asserts all five rows agree on validity; exits 1 otherwise. | two-track interpreter (dist), two-track `D.compile` (dist), Zod 4, Valibot, ArkType |
| `railway-vs.mjs` | The three-step railway over 1M items (the same workload as the root `bench/encodings.ts`) by approach. | plain union, two-track combinators (dist), exceptions, Ramda ×2, Effect ×2 |

Both are **report only**: third-party versions drift and shared CI runners are noisy, so there are no thresholds here. The library's own performance gates are the root `pnpm bench:check` ratio, `pnpm check:lanes` and `pnpm check:bundle`. Results with their dates and versions are recorded in `docs/references/benchmarks.md`.

ArkType note: the email rule is the same regex in all four libraries rather than ArkType's built-in `string.email`, which is a different (stricter) pattern; everything else is expressed identically.
