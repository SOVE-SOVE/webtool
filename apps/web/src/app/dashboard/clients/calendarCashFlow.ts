import type { NextPaymentObligation, RevenueTransaction } from "@/lib/api";
import { NEXT_PAYMENT_KIND_LABEL, obligationKey } from "../../../lib/billing";
import { calendarPeriodBounds, calendarRangeLabel, isoToLocalDate, toDateKey } from "../../../lib/calendarGrid";
import type { CalendarEntry, CalendarEntryStatus } from "./RevenueCalendar";
import { emptyDayTotals, type DayTotals, type RevenueFocus } from "./revenueVisuals";

/**
 * The Revenue calendar's cash-flow layer: both series on every day —
 * RECEIVED (payments, by received date) and OUTSTANDING (unpaid
 * obligations, by due date) — plus weekly totals and one shared bar
 * scale. Per-day sums come from revenueVisuals.totalsByDay, so the
 * definitions are the existing ones (net of refunds, reversals never
 * summed, overdue ⊂ outstanding, scheduled never overdue, one currency).
 * Dates are plain YYYY-MM-DD keys: the server already placed each record
 * on its workspace-timezone date, and nothing here re-derives a date
 * from a timestamp.
 */

export function transactionStatus(tx: RevenueTransaction): CalendarEntryStatus {
  if (tx.voided) return "reversed";
  if (tx.refunded_cents > 0) return "refunded";
  return "paid";
}

// Overdue = the server's rule (unpaid, due before today) for real charges
// only. A projected, not-yet-issued hosting charge whose date has passed
// isn't counted in the Overdue total, so it isn't overdue here either.
export function obligationStatus(o: NextPaymentObligation): CalendarEntryStatus {
  if (o.is_overdue && !o.scheduled) return "overdue";
  if (o.days_relative === 0) return "due_today";
  return "upcoming";
}

export function transactionEntry(tx: RevenueTransaction): CalendarEntry {
  return {
    key: tx.payment_id,
    dateKey: tx.received_date,
    clientName: tx.client_business_name ?? "No client",
    // A reversal shows its original amount (never summed); anything else
    // is net of refunds.
    amountCents: tx.voided ? tx.amount_cents : tx.net_cents,
    status: transactionStatus(tx),
    typeLabel: tx.kind === "website" ? "Website" : "Hosting",
  };
}

/** `null` for an obligation with no due date — it can't sit on a day. */
export function obligationEntry(o: NextPaymentObligation): CalendarEntry | null {
  if (o.due_date === null) return null;
  return {
    key: obligationKey(o),
    dateKey: o.due_date,
    clientName: o.client_business_name ?? "No client",
    amountCents: o.amount_cents,
    status: obligationStatus(o),
    typeLabel: NEXT_PAYMENT_KIND_LABEL[o.kind],
    scheduled: o.scheduled,
  };
}

/** Filters that mean the same thing for both series: search text,
 * client, and website/hosting type. */
export type SharedCashFlowFilters = { q: string; clientId: string; type: "" | "website" | "hosting" };

export function transactionMatchesShared(tx: RevenueTransaction, f: SharedCashFlowFilters): boolean {
  if (f.type && tx.kind !== f.type) return false;
  if (f.clientId && tx.client_id !== f.clientId) return false;
  const q = f.q.trim().toLowerCase();
  if (!q) return true;
  return (
    tx.project_name.toLowerCase().includes(q) ||
    (tx.client_business_name ?? "").toLowerCase().includes(q) ||
    (tx.reference ?? "").toLowerCase().includes(q) ||
    (tx.method ?? "").toLowerCase().includes(q)
  );
}

export function obligationMatchesShared(o: NextPaymentObligation, f: SharedCashFlowFilters): boolean {
  if (f.type === "website" && !o.kind.startsWith("website")) return false;
  if (f.type === "hosting" && !o.kind.startsWith("hosting")) return false;
  if (f.clientId && o.client_id !== f.clientId) return false;
  const q = f.q.trim().toLowerCase();
  if (!q) return true;
  return (o.client_business_name ?? "").toLowerCase().includes(q) || o.project_name.toLowerCase().includes(q);
}

/**
 * Which series a view shows. A filter that narrows to a subset of ONE
 * series hides the other, so "Show only overdue" never still shows
 * receipts: Payments' status filter and the Received focus hide
 * Outstanding; the Hosting-charges and Overdue focuses (Upcoming) hide
 * Received. With none of those, both series show in either view.
 */
export function seriesVisibility(
  view: "payments" | "upcoming",
  focus: RevenueFocus | null,
  paymentStatus: string,
): { received: boolean; outstanding: boolean } {
  if (view === "payments") {
    const narrowsReceipts = Boolean(paymentStatus) || focus === "received";
    return { received: true, outstanding: !narrowsReceipts };
  }
  const narrowsOutstanding = focus === "hosting" || focus === "overdue";
  return { received: !narrowsOutstanding, outstanding: true };
}

export function outstandingCents(t: DayTotals): number {
  return t.dueCents + t.overdueCents;
}

export function outstandingCount(t: DayTotals): number {
  return t.dueCount + t.overdueCount;
}

/** Sum of several days' totals — a week's, for the rail and its panel. */
export function sumTotals(keys: string[], totals: Map<string, DayTotals>): DayTotals {
  const sum = emptyDayTotals();
  for (const key of keys) {
    const t = totals.get(key);
    if (!t) continue;
    sum.recordCount += t.recordCount;
    sum.receivedCents += t.receivedCents;
    sum.receivedCount += t.receivedCount;
    sum.adjustedCount += t.adjustedCount;
    sum.netAdjustmentCents += t.netAdjustmentCents;
    sum.dueCents += t.dueCents;
    sum.dueCount += t.dueCount;
    sum.overdueCents += t.overdueCents;
    sum.overdueCount += t.overdueCount;
  }
  return sum;
}

export type CalendarWeekTotal = {
  /** First grid date of the row (a Sunday). */
  weekStart: string;
  /** The row's in-scope dates — for a month grid only that month's days,
   * so a week crossing a month boundary never counts the adjacent month
   * (whose days belong to that month's own view). Empty when the row
   * has no in-scope day. */
  keys: string[];
  /** True when some of the row's 7 dates are out of scope. */
  partial: boolean;
  totals: DayTotals;
};

/** One total per 7-day grid row. `dayKeys` is the grid in display order
 * (a multiple of 7); `inScope` says which dates the view covers. */
export function calendarWeekTotals(dayKeys: string[], totals: Map<string, DayTotals>, inScope: (key: string) => boolean): CalendarWeekTotal[] {
  const weeks: CalendarWeekTotal[] = [];
  for (let i = 0; i + 7 <= dayKeys.length; i += 7) {
    const row = dayKeys.slice(i, i + 7);
    const keys = row.filter(inScope);
    weeks.push({ weekStart: row[0], keys, partial: keys.length < 7, totals: sumTotals(keys, totals) });
  }
  return weeks;
}

/** One bar scale for the whole visible period: the largest single-day
 * Received or Outstanding amount among in-scope dates (0 when there is
 * nothing to draw). Every day's bars are drawn against this — never
 * scaled per day. */
export function calendarScaleCents(dayKeys: string[], totals: Map<string, DayTotals>, inScope: (key: string) => boolean): number {
  let max = 0;
  for (const key of dayKeys) {
    if (!inScope(key)) continue;
    const t = totals.get(key);
    if (!t) continue;
    max = Math.max(max, t.receivedCents, outstandingCents(t));
  }
  return max;
}

/** Bar length as a share of the scale (0–1). A real, non-zero amount
 * never renders narrower than `minShare`, so it can't vanish. */
export function barShare(cents: number, scaleCents: number, minShare = 0.06): number {
  if (cents <= 0 || scaleCents <= 0) return 0;
  return Math.max(minShare, Math.min(1, cents / scaleCents));
}

// A week selection rides in the same `?day=` param as a single date (the
// param already carries non-date sentinels such as "overdue"), so opening
// a week goes through the existing detail mechanism.
const WEEK_PREFIX = "week:";

export function weekSelectionParam(weekStart: string): string {
  return `${WEEK_PREFIX}${weekStart}`;
}

export function parseWeekSelection(raw: string | null): string | null {
  if (!raw || !raw.startsWith(WEEK_PREFIX)) return null;
  const key = raw.slice(WEEK_PREFIX.length);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
}

/** The seven date keys of the week starting on `weekStart`. */
export function weekKeys(weekStart: string): string[] {
  const [y, m, d] = weekStart.split("-").map(Number);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(y, m - 1, d + i);
    return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  });
}

/** A month grid without its trailing rows that hold no day of that month
 * — so a month shows 4, 5 or 6 rows as it needs, never an all-other-month
 * row. (lib/calendarGrid's `monthGrid` stays a fixed 42 cells for the
 * standalone Calendar page.) */
export function trimMonthRows(days: Date[], month: number): Date[] {
  let rows = Math.ceil(days.length / 7);
  while (rows > 0 && days.slice((rows - 1) * 7, rows * 7).every((d) => d.getMonth() !== month)) rows -= 1;
  return days.slice(0, rows * 7);
}

function shortDate(key: string, withYear: boolean): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", withYear ? { day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short" });
}

export type CalendarSelection =
  | { kind: "day"; keys: [string] }
  | { kind: "week"; weekStart: string; keys: string[]; partial: boolean; heading: string; description: string | undefined };

/**
 * What `?day=` selects in the calendar: one date, or a week
 * (`week:<Sunday>`). A week in the MONTH grid covers only that month's
 * dates — the same scope its rail total summed — and says so; in the
 * week grid it covers all seven days. Other values (e.g. the Upcoming
 * view's "overdue" sentinel) aren't calendar selections: `null`.
 */
export function calendarSelectionScope(dayParam: string | null, cursor: Date, grid: "month" | "week"): CalendarSelection | null {
  if (!dayParam) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dayParam)) return { kind: "day", keys: [dayParam] };
  const weekStart = parseWeekSelection(dayParam);
  if (!weekStart) return null;
  const all = weekKeys(weekStart);
  const month = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
  const keys = grid === "month" ? all.filter((k) => k.startsWith(month)) : all;
  const partial = keys.length > 0 && keys.length < 7;
  const heading = `Week of ${shortDate(all[0], false)} – ${shortDate(all[6], true)}`;
  const monthName = cursor.toLocaleDateString("en-AU", { month: "long" });
  const description = partial
    ? `${shortDate(keys[0], false)} – ${shortDate(keys[keys.length - 1], false)} only: this week's dates in ${monthName}. The rest belong to the next or previous month.`
    : undefined;
  return { kind: "week", weekStart, keys, partial, heading, description };
}

/** The largest single-day RECEIVED amount among in-scope dates — the
 * Payments view's activity-shading scale (receipts only: shading never
 * encodes outstanding, overdue or expected money). 0 when none. */
export function calendarReceivedMaxCents(dayKeys: string[], totals: Map<string, DayTotals>, inScope: (key: string) => boolean): number {
  let max = 0;
  for (const key of dayKeys) {
    if (!inScope(key)) continue;
    max = Math.max(max, totals.get(key)?.receivedCents ?? 0);
  }
  return max;
}

/** Activity-shading step for a day's received amount: 0 (none) or
 * 1…`levels`, each step an equal share of the month's largest received
 * day — an explicit, month-wide scale, never per day. Zero, adjustments
 * and negative nets are 0 (never shaded as activity). */
export function receivedShadeLevel(cents: number, maxCents: number, levels = 4): number {
  if (cents <= 0 || maxCents <= 0) return 0;
  return Math.min(levels, Math.max(1, Math.ceil((cents / maxCents) * levels)));
}

/**
 * The selected day's (or week's) Received vs Overdue comparison — a
 * plain amount comparison, not "percentage paid" or a historical balance:
 * - Received = receipts recorded ON those dates (positive nets only —
 *   DayTotals.receivedCents).
 * - Overdue = CURRENT unpaid balance of issued charges whose DUE date is
 *   on those dates (DayTotals.overdueCents — the server's is_overdue rule
 *   as of today; scheduled charges are never overdue). Never the
 *   account-wide overdue total.
 * Received is the scope's NET: positive receipts plus any negative nets
 * (refunds exceeding a payment). Only when that net is below zero is the
 * scope "negative" — reported signed, never drawn as a slice; a month
 * holding one over-refunded payment still charts its (smaller) net. Data that hasn't loaded / failed, or a
 * series hidden by the active filters, is never shown as zero.
 */
export type BreakdownState =
  | { kind: "select" }
  | { kind: "unavailable"; series: ("received" | "overdue")[]; loading: boolean }
  | { kind: "hidden"; series: ("received" | "overdue")[] }
  | { kind: "empty" }
  | { kind: "negative"; receivedCents: number; netAdjustmentCents: number; netCents: number; overdueCents: number }
  | { kind: "chart"; receivedCents: number; overdueCents: number; netAdjustmentCents: number };

export function selectionBreakdown(
  summary: DayTotals | null,
  status: { received: "ready" | "loading" | "error"; outstanding: "ready" | "loading" | "error" },
  visible: { received: boolean; outstanding: boolean },
): BreakdownState {
  if (!summary) return { kind: "select" };
  const hidden: ("received" | "overdue")[] = [];
  if (!visible.received) hidden.push("received");
  if (!visible.outstanding) hidden.push("overdue");
  if (hidden.length > 0) return { kind: "hidden", series: hidden };
  const missing: ("received" | "overdue")[] = [];
  if (status.received !== "ready") missing.push("received");
  if (status.outstanding !== "ready") missing.push("overdue");
  if (missing.length > 0) {
    const loading = (status.received === "loading" || status.outstanding === "loading") && status.received !== "error" && status.outstanding !== "error";
    return { kind: "unavailable", series: missing, loading };
  }
  const netCents = summary.receivedCents + summary.netAdjustmentCents;
  if (netCents < 0) {
    return { kind: "negative", receivedCents: summary.receivedCents, netAdjustmentCents: summary.netAdjustmentCents, netCents, overdueCents: summary.overdueCents };
  }
  if (netCents <= 0 && summary.overdueCents <= 0) return { kind: "empty" };
  return { kind: "chart", receivedCents: netCents, overdueCents: Math.max(0, summary.overdueCents), netAdjustmentCents: summary.netAdjustmentCents };
}

/** The visible period itself — every date of the displayed month (or
 * week, in the week grid) — the panel's scope when no day or week is
 * selected, so it opens on the month's own breakdown. Exactly the dates
 * whose receipts the calendar loaded (calendarPeriodBounds). */
export type CalendarPeriodScope = { kind: "period"; keys: string[]; heading: string };

export function calendarPeriodScope(cursor: Date, grid: "month" | "week"): CalendarPeriodScope {
  const { start, end } = calendarPeriodBounds(cursor, grid);
  const keys: string[] = [];
  for (let d = isoToLocalDate(start); toDateKey(d) <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) keys.push(toDateKey(d));
  return { kind: "period", keys, heading: calendarRangeLabel(cursor, grid) };
}
