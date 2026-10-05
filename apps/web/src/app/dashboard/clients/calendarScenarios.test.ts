import { describe, expect, it } from "vitest";
import type { NextPaymentObligation, RevenueTransaction } from "@/lib/api";
import { monthGrid, toDateKey } from "../../../lib/calendarGrid";
import {
  calendarPeriodScope,
  calendarSelectionScope,
  calendarWeekTotals,
  obligationEntry,
  outstandingCents,
  selectionBreakdown,
  sumTotals,
  transactionEntry,
  trimMonthRows,
  weekSelectionParam,
} from "./calendarCashFlow";
import { totalsByDay } from "./revenueVisuals";

/**
 * Realistic Revenue-calendar scenarios, end to end through the same
 * pipeline the calendar and its breakdown use (entries → totalsByDay →
 * week totals / scope sums → selectionBreakdown). Every expected figure is
 * a hand-computed literal from the fixture below — an independent oracle,
 * not a re-run of the code under test. Workspace "today" = 2026-09-26;
 * `is_overdue` and `days_relative` are set as the server would set them.
 */

let n = 0;
function tx(date: string, net: number, o: Partial<RevenueTransaction> = {}): RevenueTransaction {
  n += 1;
  return {
    payment_id: `p${n}`, project_id: "pr", project_name: "Site", client_id: "c-cafe", client_business_name: "Cafe",
    kind: "hosting", amount_cents: net, net_cents: net, received_date: date, method: "Bank", reference: `R${n}`,
    notes: null, refunded_cents: 0, voided: false, voided_reason: null, ...o,
  };
}
function ob(due: string, amount: number, o: Partial<NextPaymentObligation> = {}): NextPaymentObligation {
  n += 1;
  return {
    kind: "hosting_charge", project_id: "pr", project_name: "Site", client_id: "c-cafe", client_business_name: "Cafe",
    amount_cents: amount, due_date: due, is_overdue: false, days_relative: 1, website_agreement_id: null,
    hosting_charge_id: `h${n}`, hosting_plan_id: "hp", scheduled: false, ...o,
  };
}
const overdue = (days: number) => ({ is_overdue: true, days_relative: -days });

const transactions: RevenueTransaction[] = [
  // (1) July: received only.
  tx("2026-07-02", 4900), tx("2026-07-02", 4900, { client_id: "c-gym", client_business_name: "Gym" }), tx("2026-07-15", 15000),
  // (11) month boundary.
  tx("2026-08-31", 4900, { client_id: "c-salon", client_business_name: "Salon" }),
  // (8) paid in September for a charge due 15 Aug (fully paid → no obligation left).
  tx("2026-09-01", 4900, { client_id: "c-gym", client_business_name: "Gym" }),
  // (6)(8) part-payment in September of the 15 Aug charge (2,900 still overdue in August).
  tx("2026-09-02", 2000),
  // (6) part-payment of a website agreement (2,000.00 remainder due 30 Sept).
  tx("2026-09-03", 100000, { kind: "website", client_id: "c-salon", client_business_name: "Salon" }),
  // (7)(9) several clients on one date, a partial refund and a reversal.
  tx("2026-09-10", 4900), tx("2026-09-10", 4900, { client_id: "c-gym", client_business_name: "Gym" }),
  tx("2026-09-10", 130000, { kind: "website", amount_cents: 150000, refunded_cents: 20000 }),
  tx("2026-09-10", 5000, { client_id: "c-salon", client_business_name: "Salon", voided: true }),
  // (10) large and sub-dollar receipts.
  tx("2026-09-12", 1234567800, { client_id: "c-gym", client_business_name: "Gym" }), tx("2026-09-14", 50),
  // (9) full refund (net 0) and refunds beyond the payment (net −5.00).
  tx("2026-09-15", 0, { amount_cents: 4000, refunded_cents: 4000 }),
  tx("2026-09-16", -500, { amount_cents: 1000, refunded_cents: 1500 }),
  // (6) part-payment of the 20 Sept charge (2,900 still overdue).
  tx("2026-09-21", 2000), tx("2026-09-26", 9900, { client_id: "c-gym", client_business_name: "Gym" }),
  // (11) year boundary.
  tx("2026-12-31", 4900), tx("2027-01-01", 700),
];

const obligations: NextPaymentObligation[] = [
  // (2) June: overdue only.
  ob("2026-06-01", 50000, { kind: "website_balance", hosting_charge_id: null, website_agreement_id: "a-gym", ...overdue(117) }),
  ob("2026-06-20", 4900, overdue(98)),
  // (8) remainder of the 15 Aug charge after the 2 Sept part-payment.
  ob("2026-08-15", 2900, overdue(42)),
  // (10) a 1-cent overdue balance.
  ob("2026-09-13", 1, overdue(13)),
  // (5) a projected (scheduled) charge whose date passed — never overdue.
  ob("2026-09-18", 4900, { scheduled: true, hosting_charge_id: null, ...overdue(8) }),
  // (6) remainder of the 20 Sept charge.
  ob("2026-09-20", 2900, overdue(6)),
  // due today — not overdue.
  ob("2026-09-26", 4900, { days_relative: 0 }),
  // (6) the website agreement's remainder, due in the future.
  ob("2026-09-30", 200000, { kind: "website_balance", hosting_charge_id: null, website_agreement_id: "a-salon", days_relative: 4 }),
  // (5) October: future only.
  ob("2026-10-05", 9900, { scheduled: true, hosting_charge_id: null, days_relative: 9 }),
  ob("2026-10-12", 4900, { days_relative: 16 }),
  // undated — never placed on a day.
  ob(null as unknown as string, 25000, { due_date: null, days_relative: null as unknown as number }),
];

const entries = [...transactions.map(transactionEntry), ...obligations.map(obligationEntry).filter((e) => e !== null)];
const totals = totalsByDay(entries);
const ready = { received: "ready" as const, outstanding: "ready" as const };
const both = { received: true, outstanding: true };

function month(y: number, m: number) {
  const cursor = new Date(y, m, 1);
  return { cursor, scope: calendarPeriodScope(cursor, "month"), grid: trimMonthRows(monthGrid(y, m), m).map(toDateKey) };
}
function breakdownFor(keys: string[]) {
  return selectionBreakdown(sumTotals(keys, totals), ready, both);
}

describe("Revenue calendar scenarios (independent expected totals)", () => {
  it("1 · a month with received payments only", () => {
    expect(breakdownFor(month(2026, 6).scope.keys)).toEqual({ kind: "chart", receivedCents: 24800, overdueCents: 0, netAdjustmentCents: 0 });
  });

  it("2 · a month with overdue payments only", () => {
    expect(breakdownFor(month(2026, 5).scope.keys)).toEqual({ kind: "chart", receivedCents: 0, overdueCents: 54900, netAdjustmentCents: 0 });
  });

  it("3, 6, 9, 10 · September: both, partial payments, refunds, large and tiny amounts", () => {
    const sept = sumTotals(month(2026, 8).scope.keys, totals);
    // Received (positive nets): 4,900 + 2,000 + 100,000 + 139,800 + 1,234,567,800 + 50 + 2,000 + 9,900.
    expect(sept.receivedCents).toBe(1234826450);
    expect(sept.netAdjustmentCents).toBe(-500);
    // Overdue due in September: 2,900 (20 Sept remainder) + 1 (13 Sept). Not 15 Aug's 2,900, not the scheduled 4,900.
    expect(sept.overdueCents).toBe(2901);
    // Outstanding = overdue + due today 4,900 + scheduled 4,900 + 30 Sept remainder 200,000 — overdue counted once.
    expect(outstandingCents(sept)).toBe(212701);
    expect(breakdownFor(month(2026, 8).scope.keys)).toEqual({ kind: "chart", receivedCents: 1234825950, overdueCents: 2901, netAdjustmentCents: -500 });
  });

  it("4 · an empty month", () => {
    expect(breakdownFor(month(2026, 10).scope.keys)).toEqual({ kind: "empty" });
  });

  it("5 · future scheduled payments are outstanding, never overdue", () => {
    const oct = sumTotals(month(2026, 9).scope.keys, totals);
    expect(oct.overdueCents).toBe(0);
    expect(outstandingCents(oct)).toBe(14800);
    expect(breakdownFor(month(2026, 9).scope.keys)).toEqual({ kind: "empty" });
    // A scheduled charge whose date has passed is still not overdue.
    expect(breakdownFor(["2026-09-18"])).toEqual({ kind: "empty" });
  });

  it("6 · partial payments: only the remaining balance is outstanding", () => {
    expect(breakdownFor(["2026-09-20"])).toEqual({ kind: "chart", receivedCents: 0, overdueCents: 2900, netAdjustmentCents: 0 });
    expect(outstandingCents(totals.get("2026-09-30")!)).toBe(200000);
    expect(totals.get("2026-09-30")!.overdueCents).toBe(0);
  });

  it("7 · several clients and payments on one date", () => {
    const d = totals.get("2026-09-10")!;
    expect(d).toMatchObject({ receivedCents: 139800, receivedCount: 3, adjustedCount: 2, recordCount: 4 });
    expect(breakdownFor(["2026-09-10"])).toEqual({ kind: "chart", receivedCents: 139800, overdueCents: 0, netAdjustmentCents: 0 });
  });

  it("8 · paid this month for a charge due last month: received in Sept, remainder overdue in Aug only", () => {
    expect(totals.get("2026-09-02")!.receivedCents).toBe(2000);
    expect(breakdownFor(month(2026, 7).scope.keys)).toEqual({ kind: "chart", receivedCents: 4900, overdueCents: 2900, netAdjustmentCents: 0 });
  });

  it("9 · full refunds and refunds beyond the payment", () => {
    expect(breakdownFor(["2026-09-15"])).toEqual({ kind: "empty" });
    expect(totals.get("2026-09-15")!.adjustedCount).toBe(1);
    expect(breakdownFor(["2026-09-16"])).toEqual({ kind: "negative", receivedCents: 0, netAdjustmentCents: -500, netCents: -500, overdueCents: 0 });
  });

  it("10 · large amounts stay exact; tiny non-zero amounts are kept", () => {
    expect(totals.get("2026-09-12")!.receivedCents).toBe(1234567800);
    expect(totals.get("2026-09-14")!.receivedCents).toBe(50);
    expect(breakdownFor(["2026-09-13"])).toEqual({ kind: "chart", receivedCents: 0, overdueCents: 1, netAdjustmentCents: 0 });
  });

  it("11 · month and year boundary weeks count each date once, in its own month", () => {
    const sept = month(2026, 8);
    const firstWeek = calendarWeekTotals(sept.grid, totals, (k) => k.startsWith("2026-09"))[0];
    expect(firstWeek.keys).toEqual(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"]);
    expect(firstWeek.totals.receivedCents).toBe(106900); // not 31 Aug's 4,900
    const sel = calendarSelectionScope(weekSelectionParam("2026-08-30"), sept.cursor, "month");
    expect(sel && breakdownFor(sel.keys)).toEqual({ kind: "chart", receivedCents: 106900, overdueCents: 0, netAdjustmentCents: 0 });

    const dec = month(2026, 11);
    const jan = month(2027, 0);
    const decLast = calendarWeekTotals(dec.grid, totals, (k) => k.startsWith("2026-12")).at(-1)!;
    const janFirst = calendarWeekTotals(jan.grid, totals, (k) => k.startsWith("2027-01"))[0];
    expect(decLast.totals.receivedCents).toBe(4900);
    expect(janFirst.totals.receivedCents).toBe(700);
  });

  it("12 · one workspace currency: records carry no currency of their own, so nothing can be mixed", () => {
    // RevenueTransaction / NextPaymentObligation have no currency field —
    // every amount is in Workspace.currency; multi-currency isn't supported.
    expect(Object.keys(transactions[0])).not.toContain("currency");
    expect(Object.keys(obligations[0])).not.toContain("currency");
  });

  it("13 · four-, five- and six-row months", () => {
    expect(month(2026, 1).grid.length / 7).toBe(4);
    expect(month(2026, 8).grid.length / 7).toBe(5);
    expect(month(2026, 7).grid.length / 7).toBe(6);
  });

  it("weekly totals add up to the month (no date counted twice or dropped)", () => {
    const sept = month(2026, 8);
    const weeks = calendarWeekTotals(sept.grid, totals, (k) => k.startsWith("2026-09"));
    const sum = weeks.reduce((s, w) => s + w.totals.receivedCents, 0);
    const od = weeks.reduce((s, w) => s + w.totals.overdueCents, 0);
    expect(sum).toBe(1234826450);
    expect(od).toBe(2901);
  });

  it("undated obligations are never placed on the calendar", () => {
    const placed = [...totals.values()].reduce((s, t) => s + outstandingCents(t), 0);
    expect(placed).toBe(50000 + 4900 + 2900 + 1 + 4900 + 2900 + 4900 + 200000 + 9900 + 4900); // excludes the undated 25,000
  });

  it("missing data is never shown as zero", () => {
    const keys = month(2026, 8).scope.keys;
    expect(selectionBreakdown(sumTotals(keys, totals), { received: "loading", outstanding: "ready" }, both)).toMatchObject({ kind: "unavailable" });
    expect(selectionBreakdown(sumTotals(keys, totals), { received: "ready", outstanding: "error" }, both)).toMatchObject({ kind: "unavailable" });
  });
});
