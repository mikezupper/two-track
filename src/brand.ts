/**
 * Brand — nominal typing on top of TypeScript's structural types.
 *
 * A brand is purely a compile-time fiction: `Brand<string, "UserId">` is a
 * string at runtime. That is why it is free. It is also why it can be forged
 * with a cast — so the ONLY place a brand is applied is inside a decoder
 * (`D.brand`), after the checks that justify it have run. The invariants
 * linter rejects `as Brand<` anywhere else.
 */

declare const BrandTag: unique symbol;

export type Brand<T, Name extends string> = T & { readonly [BrandTag]: Name };

/** The underlying primitive of a branded type. */
export type Unbrand<T> = T extends Brand<infer U, string> ? U : T;
