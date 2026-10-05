import type { NextPaymentObligation, RevenueOverdueItem, RevenueTransaction } from "@/lib/api";
import type { CalendarEntry } from "./RevenueCalendar";

/**
 * Pure calculations behind Revenue's visuals — day indicators, the linked
 * cash-flow chart, the Received sparkline and the overdue-age breakdown.
 * Every rule here restates an existing backend definition rather than
 * inventing one (billing/service.py):
 *
 * - RECEIVED = non-voided payments, net of refunds (`net_cents`), on the
 *   date the money was actually received. Invoices/charges are never
 *   "received". A reversed (voided) payment is shown, never summed.
 * - OUTSTANDING = what's still unpaid on each obligation (partial
 *   payments already deducted server-side), on its due date. An
 *   obligation is either Due or Overdue, never both. `is_overdue` is the
 *   server's own rule (due date before today in the workspace timezone).
 *   A projected, not-yet-issued hosting charge (`scheduled`) is never
 *   counted as overdue — the Overdue total doesn't count it either.
 * - Obligations without a due date can't be placed on a day; they're
 *   excluded here and reported separately by the Upcoming view.
 * - Outstanding data is today's unpaid balance only: a charge paid in
 *   full shows up as Received on its payment date, not as a past due
 *   amount — there is no historical "what was due" record to chart.
 * - One workspace currency; nothing is converted or mixed.
 */

export type DayTotals = {
  /** Distinct records on this day (a refunded payment is one record, even
   * though it's both received and adjusted). */
  recordCount: number;
  receivedCents: number;
  receivedCount: number;
  /** Refunds/reversals on this day — shown, never added to Received. */
  adjustedCount: number;
  /** Sum of any NEGATIVE net receipts (≤ 0). Refunds never exceed the
   * payment today, so this is normally 0 — but a negative net is kept as
   * a signed adjustment, never drawn as a positive bar or dropped. */
  netAdjustmentCents: number;
  dueCents: number;
  dueCount: number;
  overdueCents: number;
  overdueCount: number;
};

const EMPTY_DAY: DayTotals = {
  recordCount: 0,
  receivedCents: 0,
  receivedCount: 0,
  adjustedCount: 0,
  netAdjustmentCents: 0,
  dueCents: 0,
  dueCount: 0,
  overdueCents: 0,
  overdueCount: 0,
};

export function emptyDayTotals(): DayTotals {
  return { ...EMPTY_DAY };
}

export function dayRecordCount(t: DayTotals): number {
  return t.recordCount;
}

/** Per-day totals for a calendar view, from the SAME already-filtered
 * entries that view's day panel lists — so an indicator and the panel it
 * opens can never disagree. Payments entries: paid/refunded count as
 * Received only while their net (`amountCents`, already net of refunds)
 * is positive — the analytics' own `countsAsReceived` rule; a fully
 * refunded payment is an adjustment, and a negative net is kept as a
 * signed adjustment. Reversed is only an adjustment. Obligations:
 * overdue vs due (never both). */
export function totalsByDay(entries: CalendarEntry[]): Map<string, DayTotals> {
  const byDay = new Map<string, DayTotals>();
  for (const e of entries) {
    const t = byDay.get(e.dateKey) ?? emptyDayTotals();
    t.recordCount += 1;
    switch (e.status) {
      case "paid":
      case "refunded":
        if (e.amountCents > 0) {
          t.receivedCents += e.amountCents;
          t.receivedCount += 1;
          if (e.status === "refunded") t.adjustedCount += 1;
        } else {
          t.adjustedCount += 1;
          t.netAdjustmentCents += Math.min(0, e.amountCents);
        }
        break;
      case "reversed":
        t.adjustedCount += 1;
        break;
      case "overdue":
        t.overdueCents += e.amountCents;
        t.overdueCount += 1;
        break;
      case "due_today":
      case "upcoming":
        t.dueCents += e.amountCents;
        t.dueCount += 1;
        break;
    }
    byDay.set(e.dateKey, t);
  }
  return byDay;
}

export type OverdueAgeBucket = { label: string; minDays: number; maxDays: number | null; cents: number; count: number };

const AGE_BUCKETS: [string, number, number | null][] = [
  ["1–30 days", 1, 30],
  ["31–60 days", 31, 60],
  ["61–90 days", 61, 90],
  ["Over 90 days", 91, null],
];

/** Overdue age from the exact rows behind the Overdue total, so the
 * buckets always add up to it. */
export function overdueAgeBuckets(items: RevenueOverdueItem[]): OverdueAgeBucket[] {
  const buckets = AGE_BUCKETS.map(([label, minDays, maxDays]) => ({ label, minDays, maxDays, cents: 0, count: 0 }));
  for (const item of items) {
    const days = Math.max(1, item.days_overdue);
    const bucket = buckets.find((b) => days >= b.minDays && (b.maxDays === null || days <= b.maxDays))!;
    bucket.cents += item.outstanding_cents;
    bucket.count += 1;
  }
  return buckets;
}

/** Summary-box focus, carried in the URL as `?focus=`. Filters which
 * records the calendar/detail views show; never changes a headline. */
export type RevenueFocus = "received" | "hosting" | "overdue";

export function parseFocus(raw: string | null): RevenueFocus | null {
  return raw === "received" || raw === "hosting" || raw === "overdue" ? raw : null;
}

/** Whether an obligation belongs to a focus (Upcoming view). */
export function obligationMatchesFocus(o: NextPaymentObligation, focus: RevenueFocus | null): boolean {
  if (focus === "hosting") return o.kind === "hosting_charge" || o.kind === "hosting_scheduled";
  if (focus === "overdue") return o.is_overdue && !o.scheduled;
  return true;
}

/** Whether a transaction belongs to a focus (Payments view): "received"
 * shows only money actually received (reversals hidden). */
export function transactionMatchesFocus(tx: RevenueTransaction, focus: RevenueFocus | null): boolean {
  if (focus === "received") return !tx.voided && tx.net_cents > 0;
  return true;
}
