import { ok, type Result } from "two-track";
import * as Railway from "two-track";
import { unknown as opaqueDecoder } from "two-track/decode";
import * as Decode from "two-track/decode";
import { unwrapOr } from "two-track/result";

const mixed = (): readonly [number, Result<string, number>] => [1, ok(2)];
export const ignoredTuple = (): void => {
  mixed(); // expect: ignored-result
};

export const documentation = "@ts-ignore is a directive only inside a comment";
export const pretendAllow = "two-track-check-allow no-throw this is data, not a suppression";
export const stillReported = (): never => { throw new Error("defect"); }; // expect: no-throw

// Actual comment directives still need a finding.
/* @ts-expect-error */ // expect: no-ts-suppress
export const wrong: number = "wrong";

export const opaque = Railway.D.unknown; // expect: review-decode-unknown
export const directOpaque = opaqueDecoder; // expect: review-decode-unknown
export const namespaceOpaque = Decode.unknown; // expect: review-decode-unknown
export const directFallback = unwrapOr(ok(1), 0); // expect: review-unwrap-or

// Exhaustive defaults and the sanctioned defect must stay accepted.
const assertNever = (value: never): never => { throw new Error(String(value)); };
export const exhaustive = (kind: "a" | "b"): number => {
  switch (kind) {
    case "a": return 1;
    case "b": return 2;
    default: return assertNever(kind);
  }
};
