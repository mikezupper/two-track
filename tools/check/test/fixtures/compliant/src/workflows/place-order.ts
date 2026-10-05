import { Async, D, R, match, ok, type AsyncResult } from "two-track";
import type { Deps } from "../domain/ports.ts";
import { total } from "../domain/pure.ts";
import { InvalidCommand, PlaceOrder, type Order, type OrderError } from "../domain/types.ts";

export const placeOrder = async (deps: Deps, raw: unknown): AsyncResult<OrderError, Order> => {
  const decoded = R.mapErr(PlaceOrder.decode(raw), (e) => InvalidCommand({ issues: D.formatIssues(e) }));
  if (!decoded.ok) return decoded;
  const amount = total(decoded.value.amounts);
  const charged = await Async.retry((_, signal) => deps.payments.charge(decoded.value.userId, amount, signal), {
    attempts: 3,
    delay: Async.backoff({ baseMs: 50 }),
    retriable: (e) => e.retriable,
    sleeper: deps.sleeper,
  });
  if (!charged.ok) return charged;
  return ok({ id: deps.ids.next(), userId: decoded.value.userId, total: amount, placedAt: deps.clock.now() });
};

export const status = (e: OrderError): number => match(e, { InvalidCommand: () => 400, PaymentDeclined: ({ retriable }) => (retriable ? 503 : 402) });
