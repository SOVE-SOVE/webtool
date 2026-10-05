import { describe, expect, it } from "vitest";
import type { NextPaymentObligation, RevenueExpectedHostingPlan, RevenueTransaction } from "@/lib/api";
import {
  activeHostingClients,
  percentChange,
  previousPeriod,
  receiptsByCategory,
  resolveRange,
  todayInTimeZone,
  weeklyCashFlow,
} from "./revenueAnalytics";

const tx = (o: Partial<RevenueTransaction> = {}): RevenueTransaction => ({
  payment_id: "p", project_id: "pr", project_name: "Site", client_id: "c1", client_business_name: "Cafe", kind: "hosting",
  amount_cents: 5000, net_cents: 5000, received_date: "2026-09-10", method: null, reference: null, notes: null,
  refunded_cents: 0, voided: false, voided_reason: null, ...o,
});
const ob = (o: Partial<NextPaymentObligation> = {}): NextPaymentObligation => ({
  kind: "hosting_charge", project_id: "pr", project_name: "Site", client_id: "c1", client_business_name: "Cafe",
  amount_cents: 4900, due_date: "2026-09-28", is_overdue: false, days_relative: 2, website_agreement_id: null,
  hosting_charge_id: "h", hosting_plan_id: "hp", scheduled: false, ...o,
});

describe("ranges", () => {
  it("resolves month-aligned presets across year boundaries", () => {
    expect(resolveRange("this_month", "2026-01-15")).toMatchObject({ start: "2026-01-01", end: "2026-01-31" });
    expect(resolveRange("last_month", "2026-01-15")).toMatchObject({ start: "2025-12-01", end: "2025-12-31" });
    expect(resolveRange("last_3_months", "2026-02-10")).toMatchObject({ start: "2025-12-01", end: "2026-02-28" });
    expect(resolveRange("year_to_date", "2026-09-26")).toMatchObject({ start: "2026-01-01", end: "2026-09-30" });
  });

  it("compares like-for-like elapsed days, and only against periods with records", () => {
    const r = resolveRange("this_month", "2026-09-26");
    expect(previousPeriod(r, "2026-09-26", "2026-01-01")).toEqual({ start: "2026-08-06", end: "2026-08-31", comparable: true, elapsedOnly: true });
    expect(previousPeriod(r, "2026-09-26", "2026-08-20").comparable).toBe(false);
    expect(previousPeriod(r, "2026-09-26", null).comparable).toBe(false);
    expect(percentChange(150, 100, true)).toBe(50);
    expect(percentChange(150, 0, true)).toBeNull(); // no zero-baseline percentages
    expect(percentChange(150, 100, false)).toBeNull();
  });

  it("uses the workspace timezone for today", () => {
    const instant = new Date("2026-09-30T15:30:00Z"); // 1 Oct 01:30 in Brisbane, still 30 Sep in UTC
    expect(todayInTimeZone("Australia/Brisbane", instant)).toBe("2026-10-01");
    expect(todayInTimeZone("UTC", instant)).toBe("2026-09-30");
  });
});

describe("receiptsByCategory", () => {
  it("classifies each net receipt once; voided and fully refunded add nothing", () => {
    const slices = receiptsByCategory([
      tx({ kind: "website", net_cents: 130000, amount_cents: 150000, refunded_cents: 20000 }),
      tx({ kind: "hosting", net_cents: 4900 }),
      tx({ kind: "hosting", net_cents: 4900 }),
      tx({ kind: "hosting", voided: true }),
      tx({ kind: "website", net_cents: 0, refunded_cents: 5000 }),
    ]);
    expect(slices.map((s) => [s.category, s.cents, s.count])).toEqual([["website", 130000, 1], ["hosting", 9800, 2]]);
    expect(slices.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1);
  });
  it("zero receipts → zero shares, no uncategorised slice", () => {
    expect(receiptsByCategory([])).toEqual([
      { category: "website", cents: 0, count: 0, share: 0 },
      { category: "hosting", cents: 0, count: 0, share: 0 },
    ]);
  });
});

describe("weeklyCashFlow", () => {
  it("weeks are Sunday–Saturday (like the calendar) clamped to the range; received by receipt date, scheduled by due date", () => {
    const weeks = weeklyCashFlow(
      "2026-09-01",
      "2026-09-30",
      [tx({ received_date: "2026-09-10" }), tx({ received_date: "2026-08-31" })],
      [
        ob({ due_date: "2026-09-28", amount_cents: 3000 }), // remainder after a partial payment
        ob({ due_date: "2026-09-20", is_overdue: true }),
        ob({ due_date: "2026-09-18", is_overdue: true, scheduled: true, kind: "hosting_scheduled" }),
        ob({ due_date: null }),
      ],
      "2026-09-26",
    );
    expect(weeks.map((w) => `${w.weekStart}..${w.weekEnd}`)).toEqual([
      "2026-09-01..2026-09-05", "2026-09-06..2026-09-12", "2026-09-13..2026-09-19", "2026-09-20..2026-09-26", "2026-09-27..2026-09-30",
    ]);
    expect(weeks[1]).toMatchObject({ receivedCents: 5000, receivedCount: 1 });
    expect(weeks[2]).toMatchObject({ notInvoicedCents: 4900, overdueCents: 0 }); // 18 Sep projection
    expect(weeks[3]).toMatchObject({ overdueCents: 4900, expectedCents: 0 }); // 20 Sep charge
    expect(weeks[4]).toMatchObject({ expectedCents: 3000, expectedCount: 1 });
    expect(weeks.reduce((s, w) => s + w.receivedCents, 0)).toBe(5000); // 31 Aug excluded
  });
  it("weeks before the workspace existed with nothing in them are 'no records', not zero", () => {
    const weeks = weeklyCashFlow("2026-05-01", "2026-06-13", [], [ob({ due_date: "2026-05-20", is_overdue: true })], "2026-09-26", null, "2026-06-01");
    const byStart = Object.fromEntries(weeks.map((w) => [w.weekStart, w.available]));
    expect(byStart["2026-05-10"]).toBe(false);
    expect(byStart["2026-05-17"]).toBe(true); // has an (old) overdue charge — real data
    expect(byStart["2026-05-31"]).toBe(true); // reaches 1 June
  });
});

describe("activeHostingClients", () => {
  it("counts distinct clients, keeping prospect-only plans separate", () => {
    const p = (client_id: string | null) => ({ client_id }) as RevenueExpectedHostingPlan;
    expect(activeHostingClients([p("a"), p("a"), p("b"), p(null)])).toEqual({ clientCount: 2, planCount: 4, prospectPlanCount: 1 });
  });
});
