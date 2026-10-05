import { query } from "../infra/db.ts"; // expect: layer-workflows-imports
import { join } from "node:path"; // expect: layer-workflows-imports
import pg from "pg"; // expect: layer-workflows-imports
import { Async, ok, type AsyncResult } from "two-track";

const step = async (): AsyncResult<never, number> => ok(1);

export const floating = (): void => {
  step(); // expect: floating-async-result
};

export const ignoredAsync = async (): Promise<void> => {
  await step(); // expect: ignored-result
};

export const explicitDiscard = (): void => {
  void step(); // fine: explicit discard
};

export const caught = (): Promise<number> => step().then(() => 1).catch(() => 0); // expect: no-catch

export const fanOut = (): Promise<unknown[]> => Promise.all([step(), step()]); // expect: no-bare-promise-all

export const fine = (): AsyncResult<never, number[]> => Async.mapConcurrent([1, 2], async (n) => ok(n), { concurrency: 2 });

export const unused = [query, join, pg];
