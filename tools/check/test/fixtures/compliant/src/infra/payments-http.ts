import { Async, err, ok, type AsyncResult } from "two-track";
import type { Payments } from "../domain/ports.ts";
import { PaymentDeclined } from "../domain/types.ts";

export const httpPayments = (baseUrl: string): Payments => ({
  charge: (userId, amount, signal) =>
    Async.andThen(
      Async.tryPromise((s) => fetch(`${baseUrl}/charge`, { method: "POST", body: JSON.stringify({ userId, amount }), signal: s }), () => PaymentDeclined({ reason: "network", retriable: true }), signal),
      (res): AsyncResult<ReturnType<typeof PaymentDeclined>, void> => Promise.resolve(res.ok ? ok(undefined) : err(PaymentDeclined({ reason: `http ${res.status}`, retriable: res.status >= 500 }))),
    ),
});
