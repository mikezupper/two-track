/** Decode throughput and orchestration overhead. Best of seven, fixed checksums; no I/O. */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const dirIndex = process.argv.indexOf("--dir");
const moduleUrl = dirIndex < 0 ? new URL("../src/index.ts", import.meta.url) : pathToFileURL(resolve(process.argv[dirIndex + 1] as string, "index.js"));
const { Async, D, Lane, ok }: typeof import("../src/index.ts") = await import(moduleUrl.href);

const N = 200_000;
const user = { name: "Ada", age: 37 };
const users = Array.from({ length: 20 }, () => user);
const person = D.struct({ name: D.nonEmptyString, age: D.integer });
const personCompiled = D.compile(person);
const list = D.array(person);
const alternative = D.oneOf(person, D.string);
const integerList = D.array(D.integer);
const numbers = Array.from({ length: 40 }, (_, i) => i);
const invalidNumbers = numbers.map(String);

const measure = (name: string, run: () => number, expected: number): void => {
  let best = Number.POSITIVE_INFINITY;
  for (let repeat = 0; repeat < 7; repeat++) {
    const start = performance.now();
    const checksum = run();
    best = Math.min(best, performance.now() - start);
    if (checksum !== expected) throw new Error(`${name}: incorrect checksum ${checksum}`);
  }
  console.log(`${name.padEnd(30)} ${best.toFixed(2).padStart(8)} ms`);
};

console.log(`${process.version}, decode N=${N}, async batches=2000 x 40 (all-success, immediately resolved callbacks)`);
measure("struct success", () => {
  let sum = 0;
  for (let i = 0; i < N; i++) { const r = person.decode(user); if (r.ok) sum += r.value.age; }
  return sum;
}, N * user.age);
measure("struct success (D.compile)", () => {
  let sum = 0;
  for (let i = 0; i < N; i++) { const r = personCompiled.decode(user); if (r.ok) sum += r.value.age; }
  return sum;
}, N * user.age);
measure("array of structs success", () => {
  let sum = 0;
  for (let i = 0; i < N / 20; i++) { const r = list.decode(users); if (r.ok) sum += r.value.length; }
  return sum;
}, N);
measure("oneOf first success", () => {
  let sum = 0;
  for (let i = 0; i < N; i++) { const r = alternative.decode(user); if (r.ok && typeof r.value !== "string") sum += r.value.age; }
  return sum;
}, N * user.age);
measure("array error accumulation", () => {
  let sum = 0;
  for (let i = 0; i < N / 40; i++) { const r = integerList.decode(invalidNumbers); if (!r.ok) sum += r.error.issues.length; }
  return sum;
}, N);

for (const [name, run] of [
  ["mapConcurrent immediate", () => Async.mapConcurrent(numbers, ok, { concurrency: 4 })],
  ["validateConcurrent immediate", () => Async.validateConcurrent(numbers, ok, { concurrency: 4 })],
] as const) {
  let best = Number.POSITIVE_INFINITY;
  for (let repeat = 0; repeat < 7; repeat++) {
    const start = performance.now();
    let sum = 0;
    for (let i = 0; i < 2000; i++) { const r = await run(); if (r.ok) sum += r.value.length; }
    if (sum !== 80_000) throw new Error(`${name}: incorrect checksum ${sum}`);
    best = Math.min(best, performance.now() - start);
  }
  console.log(`${name.padEnd(30)} ${best.toFixed(2).padStart(8)} ms`);
}
let best = Number.POSITIVE_INFINITY;
for (let repeat = 0; repeat < 7; repeat++) {
  const sem = Lane.semaphore(4);
  const start = performance.now();
  let sum = 0;
  for (let i = 0; i < 20_000; i++) { const r = await sem.run(async () => ok(1)); if (r.ok) sum += r.value; }
  if (sum !== 20_000 || sem.available() !== 4) throw new Error("semaphore: incorrect checksum or leaked permits");
  best = Math.min(best, performance.now() - start);
}
console.log(`${"semaphore immediate (20k)".padEnd(30)} ${best.toFixed(2).padStart(8)} ms`);
