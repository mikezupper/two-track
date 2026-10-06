/**
 * A complete railway workflow: decode at the boundary, pure domain decisions,
 * effects behind capabilities, every failure a tagged value in the signature.
 * Run: `pnpm example`
 */
import { Async, Cap, D, O, R, err, match, ok, tagged, type AsyncResult, type Infer, type Option, type Result } from "../src/index.ts";

// ---------- domain types: branded primitives, decoders are the smart constructors ----------
const Sku = D.brand(D.pattern(/^[A-Z]{3}-\d{3}$/, "expected SKU like ABC-123"), "Sku");
const UserId = D.brand(D.nonEmptyString, "UserId");
const Cents = D.brand(D.min(D.integer, 0), "Cents");
const Quantity = D.brand(D.min(D.integer, 1), "Quantity");
type Sku = Infer<typeof Sku>;
type UserId = Infer<typeof UserId>;
type Cents = Infer<typeof Cents>;
type Quantity = Infer<typeof Quantity>;
/** The one sanctioned re-brand: integer arithmetic on values that were already decoded as Cents. Lives next to the decoder. */
const cents = (n: number): Cents => Math.max(0, Math.trunc(n)) as Cents;

const CheckoutCommand = D.struct({
  userId: UserId,
  lines: D.nonEmptyArray(D.struct({ sku: Sku, qty: Quantity })),
  coupon: D.option(D.nonEmptyString),
});
type CheckoutCommand = Infer<typeof CheckoutCommand>;

type Order = {
  readonly id: string;
  readonly userId: UserId;
  readonly lines: ReadonlyArray<{ readonly sku: Sku; readonly qty: Quantity; readonly unitPrice: Cents }>;
  readonly total: Cents;
  readonly placedAt: number;
};

// ---------- errors: one tag per failure mode, with the data a handler needs ----------
const InvalidCommand = tagged("InvalidCommand")<{ issues: string }>();
const UnknownSku = tagged("UnknownSku")<{ sku: Sku }>();
const InsufficientStock = tagged("InsufficientStock")<{ sku: Sku; requested: number; available: number }>();
const PaymentDeclined = tagged("PaymentDeclined")<{ reason: string; retriable: boolean }>();
type CheckoutError =
  | ReturnType<typeof InvalidCommand>
  | ReturnType<typeof UnknownSku>
  | ReturnType<typeof InsufficientStock>
  | ReturnType<typeof PaymentDeclined>
  | Async.Aborted; // the request can be cancelled while the payment retry is waiting

// ---------- capabilities: what the workflow is allowed to do ----------
type Catalog = { readonly price: (sku: Sku) => AsyncResult<never, Option<Cents>> };
type Inventory = { readonly reserve: (sku: Sku, qty: Quantity) => AsyncResult<ReturnType<typeof InsufficientStock>, void> };
type Payments = { readonly charge: (userId: UserId, amount: Cents, signal: AbortSignal) => AsyncResult<ReturnType<typeof PaymentDeclined>, void> };
type Deps = { readonly catalog: Catalog; readonly inventory: Inventory; readonly payments: Payments; readonly clock: Cap.Clock; readonly ids: Cap.IdGen };
/** Per-request context: explicit, never ambient. The signal is the client's disconnect or the deadline. */
type Ctx = { readonly requestId: string; readonly signal: AbortSignal };

// ---------- pure core ----------
const applyCoupon = (total: Cents, coupon: Option<string>): Cents =>
  O.match(coupon, (c) => (c === "SAVE10" ? cents(total * 0.9) : total), () => total);

const sumTotal = (lines: ReadonlyArray<{ readonly qty: Quantity; readonly unitPrice: Cents }>): Cents =>
  cents(lines.reduce((acc, l) => acc + l.qty * l.unitPrice, 0));

// ---------- workflow: the railway ----------
export const checkout = async (deps: Deps, ctx: Ctx, raw: unknown): AsyncResult<CheckoutError, Order> => {
  const decoded = R.mapErr(CheckoutCommand.decode(raw), (e) => InvalidCommand({ issues: D.formatIssues(e) }));
  if (!decoded.ok) return decoded;
  const cmd: CheckoutCommand = decoded.value;

  const priced = await Async.mapConcurrent(
    cmd.lines,
    (line) =>
      Async.andThen(deps.catalog.price(line.sku), (price) =>
        R.map(O.toResult(price, () => UnknownSku({ sku: line.sku })), (unitPrice) => ({ ...line, unitPrice })),
      ),
    { concurrency: 4 },
  );
  if (!priced.ok) return priced;

  const reserved = await Async.mapConcurrent(priced.value, (l) => deps.inventory.reserve(l.sku, l.qty), { concurrency: 4 });
  if (!reserved.ok) return reserved;

  const total = applyCoupon(sumTotal(priced.value), cmd.coupon);
  // Retry only transient declines; the request signal reaches the gateway AND stops the backoff wait.
  const charged = await Async.retry((_, signal) => deps.payments.charge(cmd.userId, total, signal), {
    attempts: 3,
    delay: Async.backoff({ baseMs: 50 }),
    retriable: (e) => e.retriable,
    sleeper: Cap.instantSleeper(),
    signal: ctx.signal,
  });
  if (!charged.ok) return charged;

  return ok({ id: deps.ids.next(), userId: cmd.userId, lines: priced.value, total, placedAt: deps.clock.now() });
};

// ---------- fakes: capabilities as values ----------
export const fakeDeps = (stock: Record<string, number>, declineFirst = 0): Deps & { readonly charges: number[] } => {
  const charges: number[] = [];
  let declines = declineFirst;
  const prices: Record<string, number> = { "ABC-123": 1999, "XYZ-999": 500 };
  return {
    charges,
    catalog: { price: async (sku) => ok(O.map(O.fromNullable(prices[sku]), cents)) },
    inventory: {
      reserve: async (sku, qty) => {
        const available = stock[sku] ?? 0;
        return qty <= available ? ok(undefined) : err(InsufficientStock({ sku, requested: qty, available }));
      },
    },
    payments: {
      charge: async (_user, amount, signal) => {
        if (signal.aborted) return err(PaymentDeclined({ reason: "request cancelled", retriable: false }));
        if (declines-- > 0) return err(PaymentDeclined({ reason: "gateway timeout", retriable: true }));
        charges.push(amount);
        return ok(undefined);
      },
    },
    clock: Cap.controlledClock(1_700_000_000_000),
    ids: Cap.sequentialIds("order-"),
  };
};

// ---------- edge: the only place errors become HTTP-ish statuses ----------
type Response = { readonly status: number; readonly body: unknown };
export const toResponse = (r: Result<CheckoutError, Order>): Response =>
  R.match<CheckoutError, Order, Response>(
    r,
    (order) => ({ status: 201, body: order }),
    (e) =>
      match(e, {
        InvalidCommand: ({ issues }) => ({ status: 400, body: { error: "invalid", issues } }),
        UnknownSku: ({ sku }) => ({ status: 422, body: { error: "unknown sku", sku } }),
        InsufficientStock: (s) => ({ status: 409, body: { error: "insufficient stock", ...s } }),
        PaymentDeclined: ({ reason }) => ({ status: 402, body: { error: "payment declined", reason } }),
        Aborted: () => ({ status: 499, body: { error: "client cancelled" } }),
      }),
  );

/** A context for scripts and tests: a fresh, never-aborted signal. */
export const liveCtx = (requestId = "req-1"): Ctx => ({ requestId, signal: new AbortController().signal });

if (import.meta.main) {
  const deps = fakeDeps({ "ABC-123": 5 }, 1);
  const good = await checkout(deps, liveCtx(), { userId: "u1", lines: [{ sku: "ABC-123", qty: 2 }], coupon: "SAVE10" });
  const bad = await checkout(deps, liveCtx(), { userId: "", lines: [{ sku: "nope", qty: 0 }] });
  const short = await checkout(deps, liveCtx(), { userId: "u1", lines: [{ sku: "ABC-123", qty: 99 }], coupon: null });
  for (const r of [good, bad, short]) console.log(JSON.stringify(toResponse(r)));
}
