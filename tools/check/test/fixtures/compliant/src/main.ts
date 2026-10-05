import { Cap, R } from "two-track";
import { httpPayments } from "./infra/payments-http.ts";
import { placeOrder, status } from "./workflows/place-order.ts";

const deps = { payments: httpPayments("https://payments.example"), clock: Cap.systemClock, ids: Cap.systemIdGen, sleeper: Cap.systemSleeper };
const result = await placeOrder(deps, { userId: "u1", amounts: [100, 250] });
console.log(R.match(result, (o) => `201 ${o.id}`, (e) => `${status(e)} ${e._tag}`));
