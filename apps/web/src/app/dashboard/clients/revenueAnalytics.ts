import type { NextPaymentObligation, RevenueExpectedHostingPlan, RevenueTransaction } from "@/lib/api";

/**
 * Pure aggregation behind the Revenue analytics dashboard. Definitions
 * (restated from billing/service.py — nothing new):
 *
 * - RECEIVED: non-voided payments, net of refunds (`net_cents`), dated by
 *   the day the money arrived. Fully refunded (net 0) payments add nothing.
 * - CATEGORY: every payment is allocated to exactly one website agreement
 *   OR one hosting charge (DB check `ck_payment_single_allocation`), so a
 *   receipt is classified once: "website" or "hosting". "uncategorised"
 *   exists only as a guard for an unexpected kind and is otherwise empty.
 * - SCHEDULED / EXPECTED: today's unpaid remainder of each obligation
 *   (partial payments already deducted) on its due date. It is expected,
 *   not guaranteed income. A past due date on a real charge is OVERDUE
 *   (server rule, workspace timezone); a projected, not-yet-issued hosting
 *   charge whose date has passed is "not yet invoiced", never overdue
 *   (matches the Overdue total).
 * - History: nothing is inferred before the workspace existed; a period
 *   before that with no receipts is "no records", not a genuine zero.
 * - One workspace currency; nothing is converted or mixed.
 */

export type ReceiptCategory = "website" | "hosting" | "uncategorised";

export const RECEIPT_CATEGORY_LABEL: Record<ReceiptCategory, string> = {
  website: "Website builds",
  hosting: "Hosting",
  uncategorised: "Uncategorised",
};

export function receiptCategory(tx: Pick<RevenueTransaction, "kind">): ReceiptCategory {
  return tx.kind === "website" || tx.kind === "hosting" ? tx.kind : "uncategorised";
}

function countsAsReceived(tx: RevenueTransaction): boolean {
  return !tx.voided && tx.net_cents > 0;
}

// --- Dates (plain YYYY-MM-DD keys; no Date-timezone drift) ---------------

function parts(key: string): [number, number, number] {
  const [y, m, d] = key.split("-").map(Number);
  return [y, m, d];
}
function keyOf(y: number, m: number, d: number): string {
  const date = new Date(Date.UTC(y, m - 1, d));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
export function addDays(key: string, days: number): string {
  const [y, m, d] = parts(key);
  return keyOf(y, m, d + days);
}
/** Sunday-first, matching the calendar's own week grid (lib/calendarGrid
 * `weekGrid`), so a week picked on a chart opens exactly that calendar week. */
function dayOfWeekSundayFirst(key: string): number {
  const [y, m, d] = parts(key);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // Sun=0 … Sat=6
}
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}
function monthStart(key: string): string {
  const [y, m] = parts(key);
  return keyOf(y, m, 1);
}
function monthEnd(key: string): string {
  const [y, m] = parts(key);
  return keyOf(y, m + 1, 0);
}

/** "Today" as a date key in the workspace's own timezone (the same
 * boundary the server uses for overdue); falls back to the browser's
 * local date if the zone is unknown. */
export function todayInTimeZone(timeZone: string | null | undefined, now: Date = new Date()): string {
  try {
    if (timeZone) {
      const f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
      return f.format(now); // en-CA formats as YYYY-MM-DD
    }
  } catch {
    // unknown zone — fall through
  }
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// --- Date range presets ---------------------------------------------------

export type RangePreset = "this_month" | "last_month" | "last_3_months" | "last_6_months" | "last_12_months" | "year_to_date";

export const RANGE_PRESET_LABEL: Record<RangePreset, string> = {
  this_month: "This month",
  last_month: "Last month",
  last_3_months: "Last 3 months",
  last_6_months: "Last 6 months",
  last_12_months: "Last 12 months",
  year_to_date: "Year to date",
};

export const RANGE_PRESETS = Object.keys(RANGE_PRESET_LABEL) as RangePreset[];

export type DateRange = { preset: RangePreset; start: string; end: string };

export function parseRangePreset(raw: string | null): RangePreset {
  return raw && raw in RANGE_PRESET_LABEL ? (raw as RangePreset) : "this_month";
}

/** Month-aligned ranges ending at today's month (partial months end at the
 * month's last day — receipts can't exist after today anyway, and scheduled
 * amounts later in the month are real). */
export function resolveRange(preset: RangePreset, today: string): DateRange {
  const thisMonth = monthStart(today);
  const [y, m] = parts(thisMonth);
  switch (preset) {
    case "this_month":
      return { preset, start: thisMonth, end: monthEnd(thisMonth) };
    case "last_month": {
      const start = keyOf(y, m - 1, 1);
      return { preset, start, end: monthEnd(start) };
    }
    case "last_3_months":
      return { preset, start: keyOf(y, m - 2, 1), end: monthEnd(thisMonth) };
    case "last_6_months":
      return { preset, start: keyOf(y, m - 5, 1), end: monthEnd(thisMonth) };
    case "last_12_months":
      return { preset, start: keyOf(y, m - 11, 1), end: monthEnd(thisMonth) };
    case "year_to_date":
      return { preset, start: keyOf(y, 1, 1), end: monthEnd(thisMonth) };
  }
}

/** The equal-length period immediately before — `comparable` only when it
 * lies entirely on or after `historyStart` (so a % change never compares
 * against a period the workspace has no records for), and the current
 * period is complete (ends before today) OR is compared like-for-like
 * against the same number of elapsed days. */
export function previousPeriod(
  range: DateRange,
  today: string,
  historyStart: string | null,
): { start: string; end: string; comparable: boolean; elapsedOnly: boolean } {
  const currentEnd = range.end < today ? range.end : today;
  const lengthDays = daysBetween(range.start, currentEnd) + 1;
  const prevEnd = addDays(range.start, -1);
  const prevStart = addDays(prevEnd, -(lengthDays - 1));
  const comparable = historyStart !== null && prevStart >= historyStart;
  return { start: prevStart, end: prevEnd, comparable, elapsedOnly: currentEnd !== range.end };
}

/** Percentage change, or null when there's nothing honest to say
 * (not comparable, or a zero baseline). */
export function percentChange(current: number, previous: number, comparable: boolean): number | null {
  if (!comparable || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

// --- Donut: receipts by category -----------------------------------------

export type CategorySlice = { category: ReceiptCategory; cents: number; count: number; share: number };

export function receiptsByCategory(transactions: RevenueTransaction[], clientId?: string | null): CategorySlice[] {
  const totals: Record<ReceiptCategory, { cents: number; count: number }> = {
    website: { cents: 0, count: 0 },
    hosting: { cents: 0, count: 0 },
    uncategorised: { cents: 0, count: 0 },
  };
  for (const tx of transactions) {
    if (!countsAsReceived(tx)) continue;
    if (clientId && tx.client_id !== clientId) continue;
    const t = totals[receiptCategory(tx)];
    t.cents += tx.net_cents;
    t.count += 1;
  }
  const sum = totals.website.cents + totals.hosting.cents + totals.uncategorised.cents;
  return (Object.keys(totals) as ReceiptCategory[])
    .filter((c) => c !== "uncategorised" || totals[c].cents > 0)
    .map((category) => ({ category, ...totals[category], share: sum > 0 ? totals[category].cents / sum : 0 }));
}

// --- Weekly cash flow ------------------------------------------------------

export type WeekFlow = {
  weekStart: string; // Sunday (clamped to the range start for the first week)
  weekEnd: string; // Saturday (clamped to the range end)
  receivedCents: number;
  receivedCount: number;
  /** Unpaid, due today or later — expected, not guaranteed. */
  expectedCents: number;
  expectedCount: number;
  /** Unpaid real charges whose due date has passed. */
  overdueCents: number;
  overdueCount: number;
  /** Projected hosting charges whose date passed before being issued. */
  notInvoicedCents: number;
  notInvoicedCount: number;
  /** False when the whole week predates the workspace and has nothing in
   * it — "no records", never a genuine zero. */
  available: boolean;
};

export function weeklyCashFlow(
  start: string,
  end: string,
  transactions: RevenueTransaction[],
  obligations: NextPaymentObligation[] | null,
  today: string,
  clientId?: string | null,
  historyStart: string | null = null,
): WeekFlow[] {
  const weeks: WeekFlow[] = [];
  let cursor = start;
  while (cursor <= end) {
    const weekFirst = addDays(cursor, -dayOfWeekSundayFirst(cursor));
    const weekLast = addDays(weekFirst, 6);
    weeks.push({
      weekStart: cursor,
      weekEnd: weekLast < end ? weekLast : end,
      receivedCents: 0,
      receivedCount: 0,
      expectedCents: 0,
      expectedCount: 0,
      overdueCents: 0,
      overdueCount: 0,
      notInvoicedCents: 0,
      notInvoicedCount: 0,
      available: true,
    });
    cursor = addDays(weekLast, 1);
  }
  const find = (key: string) => weeks.find((w) => key >= w.weekStart && key <= w.weekEnd);
  for (const tx of transactions) {
    if (!countsAsReceived(tx) || (clientId && tx.client_id !== clientId)) continue;
    const w = find(tx.received_date);
    if (!w) continue;
    w.receivedCents += tx.net_cents;
    w.receivedCount += 1;
  }
  for (const o of obligations ?? []) {
    if (!o.due_date || o.amount_cents <= 0 || (clientId && o.client_id !== clientId)) continue;
    const w = find(o.due_date);
    if (!w) continue;
    if (o.due_date < today && o.scheduled) {
      w.notInvoicedCents += o.amount_cents;
      w.notInvoicedCount += 1;
    } else if (o.is_overdue && !o.scheduled) {
      w.overdueCents += o.amount_cents;
      w.overdueCount += 1;
    } else {
      w.expectedCents += o.amount_cents;
      w.expectedCount += 1;
    }
  }
  for (const w of weeks) {
    const hasData = w.receivedCount + w.expectedCount + w.overdueCount + w.notInvoicedCount > 0;
    w.available = hasData || historyStart === null || w.weekEnd >= historyStart;
  }
  return weeks;
}

// --- Active hosting clients ------------------------------------------------

export function activeHostingClients(plans: RevenueExpectedHostingPlan[]): {
  clientCount: number;
  planCount: number;
  prospectPlanCount: number;
} {
  const clients = new Set(plans.filter((p) => p.client_id).map((p) => p.client_id as string));
  return { clientCount: clients.size, planCount: plans.length, prospectPlanCount: plans.filter((p) => !p.client_id).length };
}
