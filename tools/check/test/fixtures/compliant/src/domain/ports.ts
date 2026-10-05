import type { AsyncResult, Cap } from "two-track";
import type { Cents, PaymentDeclined, UserId } from "./types.ts";

export type Payments = { readonly charge: (userId: UserId, amount: Cents, signal: AbortSignal) => AsyncResult<ReturnType<typeof PaymentDeclined>, void> };
export type Deps = { readonly payments: Payments; readonly clock: Cap.Clock; readonly ids: Cap.IdGen; readonly sleeper: Cap.Sleeper };
