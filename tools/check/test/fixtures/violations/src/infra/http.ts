export const a = (url: string): Promise<Response> => fetch(url); // expect: fetch-needs-signal
export const b = (url: string): Promise<Response> => fetch(url, { method: "POST" }); // expect: fetch-needs-signal
export const c = (url: string, init: RequestInit): Promise<Response> => fetch(url, init); // expect: fetch-needs-signal
export const d = (url: string, init: RequestInit): Promise<Response> => fetch(url, { ...init }); // expect: fetch-needs-signal
export const e = (url: string, signal: AbortSignal): Promise<Response> => fetch(url, { signal }); // fine

export async function* lines(src: ReadonlyArray<string>): AsyncGenerator<string> { // fine: stream adapter in infra/
  for (const s of src) yield s;
}
export function* sync(): Generator<number> { // expect: no-generators
  yield 1;
}

// two-track-check-allow no-throw
export const noReason = (): never => { throw new Error("x"); }; // expect: no-throw, allow-needs-reason
// two-track-check-allow no-throw this is a documented defect path for the fixture
export const withReason = (): never => { throw new Error("y"); }; // suppressed
