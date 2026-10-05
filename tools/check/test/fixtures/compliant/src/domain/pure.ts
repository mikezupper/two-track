import type { Cents } from "./types.ts";
import { cents } from "./types.ts";

export const total = (amounts: ReadonlyArray<Cents>): Cents => cents(amounts.reduce((a, b) => a + b, 0));
