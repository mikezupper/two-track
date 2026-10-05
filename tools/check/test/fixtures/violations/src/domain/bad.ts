import { readFileSync } from "node:fs"; // expect: layer-domain-imports
import { query } from "../infra/db.ts"; // expect: layer-domain-imports
import { D, O, R, ok, err, type Brand, type Result } from "two-track";
import { type Cents } from "./types.ts";

export const now = (): number => Date.now(); // expect: no-platform-calls
export const today = (): Date => new Date(); // expect: no-platform-calls
export const roll = (): number => Math.random(); // expect: no-platform-calls
export const id = (): string => crypto.randomUUID(); // expect: no-platform-calls
export const later = (f: () => void): void => void setTimeout(f, 10); // expect: no-platform-calls
export const log = (s: string): void => console.log(s); // expect: no-console

export class Order { constructor(readonly total: number) {} } // expect: no-class
export const loose = (x: any): number => x; // expect: no-any
export const bang = (x: number | undefined): number => x!; // expect: no-non-null
export const forged = (n: number): Cents => n as Cents; // expect: no-brand-cast
export const forged2 = (n: number): Brand<number, "Qty"> => n as Brand<number, "Qty">; // expect: no-brand-cast
export const double = (n: number): string => n as unknown as string; // expect: no-brand-cast
export const frozen = Object.freeze({ a: 1 }); // expect: no-freeze

export function* gen(): Generator<number> { // expect: no-generators
  yield 1;
}

export const boom = (): never => {
  throw new Error("boom"); // expect: no-throw
};

export const risky = (s: string): unknown => {
  try { // expect: no-try
    return JSON.parse(s);
  } catch {
    return undefined;
  }
};

type Shape = { kind: "a" } | { kind: "b" };
export const label = (s: Shape): string => {
  switch (s.kind) {
    case "a":
      return "a";
    default: // expect: switch-default-without-assert-never
      return "other";
  }
};

const parse = (s: string): Result<string, number> => (s === "" ? err("empty") : ok(s.length));
export const ignores = (s: string): void => {
  parse(s); // expect: ignored-result
};

const inputs: ReadonlyArray<string> = ["a", "", "bc"];
export const blindSpots = (): void => {
  inputs.forEach((s) => parse(s)); // expect: ignored-result-in-callback
  inputs.forEach(parse); // expect: ignored-result-in-callback
  inputs.map(parse); // expect: ignored-result
  inputs.map((s) => parse(s)).filter((r) => r.ok); // expect: ignored-result
  inputs.forEach((s) => { // expect: ignored-result-in-callback
    return parse(s);
  });
};
export const fineLoops = (): Result<string, number[]> => {
  const out: number[] = [];
  for (const s of inputs) {
    const r = parse(s);
    if (!r.ok) return r;
    out.push(r.value);
  }
  inputs.forEach((s) => { void parse(s); }); // fine: explicit discard inside the callback
  return ok(out);
};

export const hatch = D.unknown; // expect: review-decode-unknown
export const fallback = (r: Result<string, number>): number => R.unwrapOr(r, 0); // expect: review-unwrap-or
export const fallbackO = (o: O.Option<number>): number => O.unwrapOr(o, 0); // expect: review-unwrap-or

// @ts-ignore  // expect: no-ts-suppress
export const broken: number = readFileSync as never;
export const q = query;
