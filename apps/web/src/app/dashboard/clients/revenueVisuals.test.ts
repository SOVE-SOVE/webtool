import { describe, expect, it } from "vitest";
import type { NextPaymentObligation, RevenueOverdueItem, RevenueTransaction } from "@/lib/api";
import {
  dayRecordCount,
  obligationMatchesFocus,
  overdueAgeBuckets,
  parseFocus,
  totalsByDay,
  transactionMatchesFocus,
} from "./revenueVisuals";
import type { CalendarEntry } from "./RevenueCalendar";

function tx(o: Partial<RevenueTransaction> = {}): RevenueTransaction {
  return {
    payment_id: "p1", project_id: "pr1", project_name: "Site", client_id: "c1", client_business_name: "Cafe",
    kind: "hosting", amount_cents: 5000, net_cents: 5000, received_date: "2026-09-10", method: null, reference: null,
    notes: null, refunded_cents: 0, voided: false, voided_reason: null, ...o,
  };
}
function ob(o: Partial<NextPaymentObligation> = {}): NextPaymentObligation {
  return {
    kind: "hosting_charge", project_id: "pr1", project_name: "Site", client_id: "c1", client_business_name: "Cafe",
    amount_cents: 5000, due_date: "2026-09-20", is_overdue: false, days_relative: 5, website_agreement_id: null,
    hosting_charge_id: "h1", hosting_plan_id: "hp1", scheduled: false, ...o,
  };
}
function entry(o: Partial<CalendarEntry>): CalendarEntry {
  return { key: "k", dateKey: "2026-09-10", clientName: "Cafe", amountCents: 5000, status: "paid", onClick: () => {}, ...o };
}

describe("totalsByDay", () => {
  it("sums multiple payments on one day with a count, refunds net, reversals never added", () => {
    const t = totalsByDay([
      entry({ key: "a", amountCents: 5000 }),
      entry({ key: "b", amountCents: 8500, status: "refunded" }), // already net of the refund
      entry({ key: "c", amountCents: 20000, status: "reversed" }),
    ]).get("2026-09-10")!;
    expect(t).toMatchObject({ receivedCents: 13500, receivedCount: 2, adjustedCount: 2, dueCents: 0, overdueCents: 0 });
    expect(dayRecordCount(t)).toBe(3); // three records — the refunded one isn't counted twice
  });

  it("an obligation is either due or overdue, never both", () => {
    const t = totalsByDay([
      entry({ key: "a", status: "overdue", amountCents: 7000 }),
      entry({ key: "b", status: "upcoming", amountCents: 3000 }),
      entry({ key: "c", status: "due_today", amountCents: 1000 }),
    ]).get("2026-09-10")!;
    expect(t).toMatchObject({ overdueCents: 7000, overdueCount: 1, dueCents: 4000, dueCount: 2, receivedCents: 0 });
  });
});

describe("overdueAgeBuckets", () => {
  it("buckets by days overdue and adds up to the overdue total", () => {
    const items = [1, 30, 31, 75, 200].map(
      (days, i) => ({ id: `i${i}`, days_overdue: days, outstanding_cents: 1000 * (i + 1) }) as RevenueOverdueItem,
    );
    const buckets = overdueAgeBuckets(items);
    expect(buckets.map((b) => [b.label, b.count, b.cents])).toEqual([
      ["1–30 days", 2, 3000],
      ["31–60 days", 1, 3000],
      ["61–90 days", 1, 4000],
      ["Over 90 days", 1, 5000],
    ]);
    expect(buckets.reduce((s, b) => s + b.cents, 0)).toBe(15000);
  });
});

describe("focus filters", () => {
  it("parses only known values", () => {
    expect(parseFocus("overdue")).toBe("overdue");
    expect(parseFocus("nope")).toBeNull();
  });
  it("hosting keeps hosting charges and projections; overdue excludes projections", () => {
    expect(obligationMatchesFocus(ob({ kind: "website_balance" }), "hosting")).toBe(false);
    expect(obligationMatchesFocus(ob({ kind: "hosting_scheduled", scheduled: true }), "hosting")).toBe(true);
    expect(obligationMatchesFocus(ob({ is_overdue: true, scheduled: true }), "overdue")).toBe(false);
    expect(obligationMatchesFocus(ob({ is_overdue: true }), "overdue")).toBe(true);
  });
  it("received hides reversals and fully refunded payments", () => {
    expect(transactionMatchesFocus(tx({ voided: true }), "received")).toBe(false);
    expect(transactionMatchesFocus(tx({ net_cents: 0 }), "received")).toBe(false);
    expect(transactionMatchesFocus(tx(), "received")).toBe(true);
  });
});
