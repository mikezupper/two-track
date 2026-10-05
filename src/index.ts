/**
 * two-track — zero-dependency railway-oriented programming for TypeScript.
 *
 * Import style:
 *   import { ok, err, type Result, R, O, D, Async, Cap } from "two-track";
 *
 * Top level: the types and the constructors you write constantly.
 * Namespaces: everything else, grouped by module so `R.map` and `O.map` coexist.
 */

export type { Result, Ok, Err, OkOf, ErrOf, NonEmptyArray } from "./result.ts";
export { ok, err, unit } from "./result.ts";
export * as R from "./result.ts";

export type { Option, Some, None } from "./option.ts";
export { some, none } from "./option.ts";
export * as O from "./option.ts";

export type { Brand, Unbrand } from "./brand.ts";

export type { Tagged, TagOf } from "./tagged.ts";
export { tagged, hasTag } from "./tagged.ts";

export type { Cases, CasesBy } from "./match.ts";
export { match, matchBy, assertNever } from "./match.ts";

export { pipe, identity, constant } from "./fn.ts";

export type { Decoder, DecodeError, DecodeIssue, Infer, StructOf, PathSegment } from "./decode.ts";
export * as D from "./decode.ts";

export type { AsyncResult, ConcurrencyOptions, RetryPolicy, BackoffOptions } from "./async.ts";
export * as Async from "./async.ts";

export type { Clock, Sleeper, Random, IdGen } from "./capabilities.ts";
export * as Cap from "./capabilities.ts";

export * as Lane from "./lanes.ts";
// `two-track/testing` is a separate entry point (see package.json exports); it is not re-exported here.
