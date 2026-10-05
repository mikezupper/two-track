import { D, tagged, type Infer } from "two-track";

export const UserId = D.brand(D.nonEmptyString, "UserId");
export const Cents = D.brand(D.min(D.integer, 0), "Cents");
export type UserId = Infer<typeof UserId>;
export type Cents = Infer<typeof Cents>;
/** The one sanctioned re-brand: integer arithmetic on already-decoded Cents. */
export const cents = (n: number): Cents => Math.max(0, Math.trunc(n)) as Cents;

export const PlaceOrder = D.struct({ userId: UserId, amounts: D.nonEmptyArray(Cents) });
export type PlaceOrder = Infer<typeof PlaceOrder>;

export const InvalidCommand = tagged("InvalidCommand")<{ issues: string }>();
export const PaymentDeclined = tagged("PaymentDeclined")<{ reason: string; retriable: boolean }>();
export type OrderError = ReturnType<typeof InvalidCommand> | ReturnType<typeof PaymentDeclined>;

export type Order = { readonly id: string; readonly userId: UserId; readonly total: Cents; readonly placedAt: number };
