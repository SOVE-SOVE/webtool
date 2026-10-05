import { formatMoney } from "../../../lib/format";
import { outstandingCents, outstandingCount } from "./calendarCashFlow";
import type { DayTotals } from "./revenueVisuals";

/**
 * Words for the Revenue calendar's bars and weekly totals — the same
 * sums the bars draw, spelled out for a cell's accessible name, its
 * tooltip and the weekly rail. Pure, so the wording is unit-tested.
 */

/** The exact amount: formatMoney's whole units ("$1,398") when the amount
 * is whole, otherwise with its cents ("$0.50", "$12,348,259.50") — so a
 * breakdown, tooltip or record row never rounds a real figure away
 * (e.g. $0.01 overdue shown as "$0"). */
export function exactMoney(cents: number, currency: string): string {
  if (cents % 100 !== 0) {
    return new Intl.NumberFormat("en-AU", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
  }
  return formatMoney(cents, currency);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "1 refund or reversal" / "3 refunds or reversals". */
export function adjustmentsLabel(n: number): string {
  return n === 1 ? "1 refund or reversal" : `${n} refunds or reversals`;
}

/** A day's (or week's) totals as one sentence for assistive tech.
 * Overdue is phrased as part of Outstanding, never as an extra amount;
 * refunds/reversals are named but never added to Received. */
export function describeDayTotals(t: DayTotals | undefined, currency: string): string {
  if (!t || t.recordCount === 0) return "No records";
  const parts: string[] = [];
  if (t.receivedCount > 0) parts.push(`Received ${exactMoney(t.receivedCents, currency)} from ${plural(t.receivedCount, "payment")}`);
  const outCount = outstandingCount(t);
  if (outCount > 0) {
    let out = `Outstanding ${exactMoney(outstandingCents(t), currency)}, ${plural(outCount, "payment")}`;
    if (t.overdueCount > 0) out += `, of which overdue ${exactMoney(t.overdueCents, currency)}`;
    parts.push(out);
  }
  if (t.adjustedCount > 0) {
    let adj = `${adjustmentsLabel(t.adjustedCount)}, not added to received`;
    if (t.netAdjustmentCents < 0) adj += ` (net ${exactMoney(t.netAdjustmentCents, currency)})`;
    parts.push(adj);
  }
  return parts.join(". ");
}

const compactFormatters = new Map<string, Intl.NumberFormat>();

/** "$1.2K" / "$12M" — the weekly rail's short amounts (exact ones are in
 * its tooltip and accessible name). Amounts under $1,000 stay whole. */
export function compactMoney(cents: number, currency: string): string {
  if (cents > 0 && cents < 100) return `<${formatMoney(100, currency)}`;
  if (Math.abs(cents) < 100_000) return formatMoney(cents, currency);
  let f = compactFormatters.get(currency);
  if (!f) {
    f = new Intl.NumberFormat("en-AU", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 });
    compactFormatters.set(currency, f);
  }
  return f.format(cents / 100);
}

function dateOf(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** "1–5 Sep", "30 Aug – 5 Sep", "28 Dec 2026 – 3 Jan 2027"; one date reads as "5 Sep". */
export function shortSpanLabel(first: string, last: string): string {
  const a = dateOf(first);
  const b = dateOf(last);
  const month = (d: Date) => d.toLocaleDateString("en-AU", { month: "short" });
  if (first === last) return `${b.getDate()} ${month(b)}`;
  if (a.getFullYear() !== b.getFullYear()) {
    const full = (d: Date) => d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
    return `${full(a)} – ${full(b)}`;
  }
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${month(b)}`;
  return `${a.getDate()} ${month(a)} – ${b.getDate()} ${month(b)}`;
}

/** Whether a calendar series' data is ready. "loading"/"error" are shown
 * as unavailable — never as a $0 amount. */
export type SeriesStatus = "ready" | "loading" | "error";

export type CalendarPrimary = "received" | "outstanding";

function unavailableWord(s: SeriesStatus): string {
  return s === "loading" ? "still loading" : "unavailable";
}

/** The amount a day tile shows: Payments → received (net), Upcoming →
 * outstanding (due + overdue). */
export function primaryCents(t: DayTotals | undefined, primary: CalendarPrimary): number {
  if (!t) return 0;
  return primary === "received" ? t.receivedCents : outstandingCents(t);
}

/**
 * A day tile's (or week tile's) accessible description: which amount the
 * tile shows, then the full totals. A series that hasn't loaded or failed
 * is said to be unavailable instead of being read as zero.
 */
export function describeCalendarTotals(
  t: DayTotals | undefined,
  currency: string,
  primary: CalendarPrimary,
  status: { received: SeriesStatus; outstanding: SeriesStatus },
  visible: { received: boolean; outstanding: boolean } = { received: true, outstanding: true },
): string {
  const parts: string[] = [];
  const primaryStatus = status[primary];
  const label = primary === "received" ? "received" : "outstanding";
  if (primaryStatus !== "ready") parts.push(`Amount shown: ${label}, ${unavailableWord(primaryStatus)}`);
  else if (t && t.recordCount > 0) parts.push(`Amount shown: ${label} ${exactMoney(primaryCents(t, primary), currency)}`);
  parts.push(describeDayTotals(t, currency));
  const secondary: CalendarPrimary = primary === "received" ? "outstanding" : "received";
  if (visible[secondary] && status[secondary] !== "ready") {
    parts.push(`${secondary === "received" ? "Received" : "Outstanding"} figures ${unavailableWord(status[secondary])}`);
  }
  return parts.join(". ");
}

function shortMonth(d: Date): string {
  return d.toLocaleDateString("en-AU", { month: "short" });
}

/** A day panel's heading: "Thu, 1 Oct 2026". */
export function shortDayHeading(key: string): string {
  const d = dateOf(key);
  const weekday = d.toLocaleDateString("en-AU", { weekday: "short" });
  return `${weekday}, ${d.getDate()} ${shortMonth(d)} ${d.getFullYear()}`;
}

/** The dates a breakdown covers, with the year — for accessible labels and
 * tooltips: "1 Oct 2026", "1–31 Oct 2026", "27 Sept – 3 Oct 2026",
 * "27 Dec 2026 – 2 Jan 2027". */
export function scopeDatesLabel(keys: string[]): string {
  if (keys.length === 0) return "";
  const first = keys[0];
  const last = keys[keys.length - 1];
  const span = shortSpanLabel(first, last);
  return first.slice(0, 4) === last.slice(0, 4) ? `${span} ${first.slice(0, 4)}` : span;
}
