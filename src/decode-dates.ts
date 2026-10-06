/**
 * Date decoders — split from decode-core.ts to keep each module under the
 * file-size invariant. Public surface is `two-track`'s `D` namespace and the
 * `two-track/decode` subpath, both of which re-export this module.
 */

import type { Decoder } from "./decode-core.ts";
import { andThen, string } from "./decode-core.ts";
import { err, ok } from "./result.ts";

/**
 * The engine's `Date` string grammar → Date. Named for what it does: it accepts whatever
 * `new Date(string)` accepts, which includes non-ISO forms and silently normalizes invalid
 * calendar dates (`2023-02-30` → March 2). Use it only when the producer is known and
 * sloppy; wire data should use `isoDate`.
 */
export const dateFromString: Decoder<Date> = /* @__PURE__ */ andThen(string, (s) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? err("expected a date string") : ok(d);
});

const ISO_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2}))?$/;

const daysInMonth = (year: number, month: number): number =>
  month === 2 ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;

/**
 * Strict ISO-8601 → Date. Accepts exactly `YYYY-MM-DD` (UTC midnight) or
 * `YYYY-MM-DDTHH:mm[:ss[.fraction]]` followed by `Z` or `±HH:mm`; rejects every other
 * form, a date-time without an offset (ambiguous on the wire), and calendar-invalid
 * dates such as `2023-02-30` or `2023-02-29`, which `new Date` would silently shift.
 * The name is the contract: if it decodes, the string was ISO-8601 and the instant is
 * the one written.
 */
export const isoDate: Decoder<Date> = /* @__PURE__ */ andThen(string, (s) => {
  const m = ISO_DATE_TIME.exec(s);
  if (m === null) return err("expected ISO-8601 date (YYYY-MM-DD) or date-time with Z/±HH:mm offset");
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return err("expected a valid calendar date");
  if (m[4] !== undefined) {
    const hour = Number(m[4]);
    const minute = Number(m[5]);
    const second = m[6] === undefined ? 0 : Number(m[6]);
    if (hour > 23 || minute > 59 || second > 59) return err("expected a valid time of day");
    const offset = m[8] as string;
    if (offset !== "Z" && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4, 6)) > 59)) return err("expected a valid UTC offset");
  }
  // V8/JSC/SpiderMonkey all parse this subset per spec; fractions beyond 3 digits are truncated.
  const d = new Date(m[7] !== undefined && m[7].length > 3 ? s.replace(`.${m[7]}`, `.${m[7].slice(0, 3)}`) : s);
  return Number.isNaN(d.getTime()) ? err("expected ISO-8601 date string") : ok(d);
});
