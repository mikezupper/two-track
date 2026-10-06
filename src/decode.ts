/**
 * Decoders — parse, don't validate. See decode-core.ts for the design and the
 * internal protocol; this module is the public surface (`D` namespace,
 * `two-track/decode` subpath): the core, the date decoders, and `compile`
 * (decode-compile.ts, decision 0014).
 */

export * from "./decode-core.ts";
export * from "./decode-dates.ts";
export { compile } from "./decode-compile.ts";
