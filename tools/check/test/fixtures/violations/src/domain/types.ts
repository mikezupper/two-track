import { D, type Infer } from "two-track";

export const Cents = D.brand(D.min(D.integer, 0), "Cents");
export type Cents = Infer<typeof Cents>;
export const cents = (n: number): Cents => n as Cents; // brandFiles: allowed here
