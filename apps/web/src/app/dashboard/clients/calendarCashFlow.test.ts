import { describe, expect, it } from "vitest";
import type { NextPaymentObligation, RevenueTransaction } from "@/lib/api";
import { monthGrid, toDateKey } from "../../../lib/calendarGrid";
import {
  barShare,
  calendarPeriodScope,
  calendarReceivedMaxCents,
  calendarSelectionScope,
  receivedShadeLevel,
  selectionBreakdown,
  calendarScaleCents,
  calendarWeekTotals,
  obligationEntry,
  obligationMatchesShared,
  outstandingCents,
  parseWeekSelection,
  seriesVisibility,
  transactionEntry,
  transactionMatchesShared,
  trimMonthRows,
  weekKeys,
  weekSelectionParam,
} from "./calendarCashFlow";
import { emptyDayTotals, totalsByDay } from "./revenueVisuals";

function tx(o: Partial<RevenueTransaction> = {}): RevenueTransaction {
  return {
    payment_id: "p1", project_id: "pr1", project_name: "Site", client_id: "c1", client_business_name: "Cafe",
    kind: "hosting", amount_cents: 5000, net_cents: 5000, received_date: "2026-09-10", method: "Bank", reference: "INV-1",
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
const entries = (txs: RevenueTransaction[], obs: NextPaymentObligation[]) => [
  ...txs.map(transactionEntry),
  ...obs.map(obligationEntry).filter((e) => e !== null),
];
const septGrid = () => trimMonthRows(monthGrid(2026, 8), 8).map(toDateKey);
const inSept = (k: string) => k.startsWith("2026-09");

describe("day totals from both series", () => {
  it("sums several receipts and charges on one date; overdue is a subset of outstanding", () => {
    const t = totalsByDay(
      entries(
        [tx({ payment_id: "a", net_cents: 5000 }), tx({ payment_id: "b", amount_cents: 10000, net_cents: 8500, refunded_cents: 1500 })],
        [
          ob({ hosting_charge_id: "h1", due_date: "2026-09-10", amount_cents: 7000, is_overdue: true, days_relative: -2 }),
          ob({ hosting_charge_id: "h2", due_date: "2026-09-10", amount_cents: 3000 }), // partial: only the remainder is outstanding
        ],
      ),
    ).get("2026-09-10")!;
    expect(t).toMatchObject({ receivedCents: 13500, receivedCount: 2, adjustedCount: 1, overdueCents: 7000, dueCents: 3000 });
    expect(outstandingCents(t)).toBe(10000); // 7000 overdue is inside it, not added on top
    expect(t.recordCount).toBe(4);
  });

  it("reversals are never received; full refunds and negative nets are adjustments, not bars", () => {
    const t = totalsByDay(
      entries(
        [
          tx({ payment_id: "rev", voided: true, amount_cents: 9000, net_cents: 9000 }),
          tx({ payment_id: "full", amount_cents: 4000, net_cents: 0, refunded_cents: 4000 }),
          tx({ payment_id: "neg", amount_cents: 1000, net_cents: -500, refunded_cents: 1500 }),
        ],
        [],
      ),
    ).get("2026-09-10")!;
    expect(t.receivedCents).toBe(0);
    expect(t.receivedCount).toBe(0);
    expect(t.adjustedCount).toBe(3);
    expect(t.netAdjustmentCents).toBe(-500); // kept, signed — never a positive bar
  });

  it("a scheduled (not yet issued) charge past its date is outstanding but never overdue", () => {
    const t = totalsByDay(entries([], [ob({ scheduled: true, is_overdue: true, due_date: "2026-09-02", days_relative: -8 })])).get("2026-09-02")!;
    expect(t).toMatchObject({ overdueCents: 0, dueCents: 5000 });
  });

  it("an obligation without a due date is not placed on any day", () => {
    expect(obligationEntry(ob({ due_date: null }))).toBeNull();
  });

  it("keeps cents exact for large amounts", () => {
    const t = totalsByDay(entries([tx({ payment_id: "x", net_cents: 123456789 }), tx({ payment_id: "y", net_cents: 1234567801 })], [])).get("2026-09-10")!;
    expect(t.receivedCents).toBe(1358024590);
  });
});

describe("month rows", () => {
  it("shows 4, 5 or 6 rows as the month needs", () => {
    expect(trimMonthRows(monthGrid(2026, 1), 1).length / 7).toBe(4); // Feb 2026 starts on Sunday, 28 days
    expect(trimMonthRows(monthGrid(2026, 8), 8).length / 7).toBe(5); // Sept 2026
    expect(trimMonthRows(monthGrid(2026, 7), 7).length / 7).toBe(6); // Aug 2026 starts Saturday, 31 days
  });
});

describe("weekly totals", () => {
  it("counts only the selected month's dates in a week that crosses the boundary, never twice", () => {
    const totals = totalsByDay(
      entries([tx({ payment_id: "aug", received_date: "2026-08-31" }), tx({ payment_id: "sep", received_date: "2026-09-01", net_cents: 2000 })], [
        ob({ due_date: "2026-08-30" }),
      ]),
    );
    const sept = calendarWeekTotals(septGrid(), totals, inSept);
    expect(sept[0].weekStart).toBe("2026-08-30");
    expect(sept[0].partial).toBe(true);
    expect(sept[0].keys[0]).toBe("2026-09-01");
    expect(sept[0].totals.receivedCents).toBe(2000); // 31 Aug belongs to August's view
    expect(outstandingCents(sept[0].totals)).toBe(0);

    const augGrid = trimMonthRows(monthGrid(2026, 7), 7).map(toDateKey);
    const aug = calendarWeekTotals(augGrid, totals, (k) => k.startsWith("2026-08"));
    const augLast = aug[aug.length - 1];
    expect(augLast.totals.receivedCents).toBe(5000);
    // Across both months' views the boundary week adds up to the whole, once.
    expect(augLast.totals.receivedCents + sept[0].totals.receivedCents).toBe(7000);
  });

  it("handles a week crossing the year boundary", () => {
    const totals = totalsByDay(entries([tx({ payment_id: "d", received_date: "2026-12-31" }), tx({ payment_id: "j", received_date: "2027-01-01", net_cents: 700 })], []));
    const jan = calendarWeekTotals(trimMonthRows(monthGrid(2027, 0), 0).map(toDateKey), totals, (k) => k.startsWith("2027-01"));
    expect(jan[0].totals.receivedCents).toBe(700);
  });

  it("an empty month has zero totals and a zero scale", () => {
    const grid = septGrid();
    const weeks = calendarWeekTotals(grid, new Map(), inSept);
    expect(weeks.every((w) => w.totals.recordCount === 0)).toBe(true);
    expect(calendarScaleCents(grid, new Map(), inSept)).toBe(0);
  });
});

describe("shared bar scale", () => {
  it("is the largest in-scope single-day amount of either series", () => {
    const totals = totalsByDay(
      entries([tx({ payment_id: "a", received_date: "2026-09-03", net_cents: 40000 }), tx({ payment_id: "b", received_date: "2026-08-31", net_cents: 999999 })], [
        ob({ due_date: "2026-09-20", amount_cents: 60000 }),
      ]),
    );
    expect(calendarScaleCents(septGrid(), totals, inSept)).toBe(60000); // 31 Aug is out of scope
  });

  it("bar share is proportional, capped at 1, and a real amount never vanishes", () => {
    expect(barShare(30000, 60000)).toBe(0.5);
    expect(barShare(1, 60000)).toBe(0.06);
    expect(barShare(0, 60000)).toBe(0);
    expect(barShare(-500, 60000)).toBe(0);
    expect(barShare(5000, 0)).toBe(0);
  });
});

describe("filters and visibility", () => {
  it("shared filters mean the same for both series", () => {
    const f = { q: "cafe", clientId: "c1", type: "hosting" as const };
    expect(transactionMatchesShared(tx(), f)).toBe(true);
    expect(obligationMatchesShared(ob(), f)).toBe(true);
    expect(transactionMatchesShared(tx({ kind: "website" }), f)).toBe(false);
    expect(obligationMatchesShared(ob({ kind: "website_balance" }), f)).toBe(false);
    expect(obligationMatchesShared(ob({ client_id: "c2" }), f)).toBe(false);
    expect(transactionMatchesShared(tx(), { q: "inv-1", clientId: "", type: "" })).toBe(true); // reference search
  });

  it("a filter narrowing one series hides the other", () => {
    expect(seriesVisibility("payments", null, "")).toEqual({ received: true, outstanding: true });
    expect(seriesVisibility("payments", null, "refunded")).toEqual({ received: true, outstanding: false });
    expect(seriesVisibility("payments", "received", "")).toEqual({ received: true, outstanding: false });
    expect(seriesVisibility("upcoming", "overdue", "")).toEqual({ received: false, outstanding: true });
    expect(seriesVisibility("upcoming", "hosting", "")).toEqual({ received: false, outstanding: true });
    expect(seriesVisibility("upcoming", null, "")).toEqual({ received: true, outstanding: true });
  });
});

describe("week selection param", () => {
  it("round-trips and rejects other values", () => {
    expect(parseWeekSelection(weekSelectionParam("2026-08-30"))).toBe("2026-08-30");
    expect(parseWeekSelection("2026-09-01")).toBeNull();
    expect(parseWeekSelection("overdue")).toBeNull();
    expect(parseWeekSelection("week:nope")).toBeNull();
    expect(weekKeys("2026-12-27")).toEqual(["2026-12-27", "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  });
});

describe("calendar selection scope", () => {
  const sept = new Date(2026, 8, 15);
  it("a date selects that day; other sentinels select nothing", () => {
    expect(calendarSelectionScope("2026-09-10", sept, "month")).toEqual({ kind: "day", keys: ["2026-09-10"] });
    expect(calendarSelectionScope("overdue", sept, "month")).toBeNull();
    expect(calendarSelectionScope(null, sept, "month")).toBeNull();
  });
  it("a week in the month grid covers only that month's dates and says so", () => {
    const s = calendarSelectionScope(weekSelectionParam("2026-08-30"), sept, "month");
    expect(s?.kind).toBe("week");
    if (s?.kind !== "week") return;
    expect(s.keys).toEqual(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"]);
    expect(s.partial).toBe(true);
    expect(s.description).toMatch(/September/);
  });
  it("a week in the week grid covers all seven days", () => {
    const s = calendarSelectionScope(weekSelectionParam("2026-08-30"), new Date(2026, 7, 30), "week");
    expect(s?.kind === "week" && s.keys.length).toBe(7);
    expect(s?.kind === "week" && s.partial).toBe(false);
  });
});

describe("received activity shading", () => {
  it("uses the month's largest received day as one explicit scale, receipts only", () => {
    const totals = totalsByDay(
      entries(
        [tx({ payment_id: "a", received_date: "2026-09-03", net_cents: 40000 }), tx({ payment_id: "b", received_date: "2026-09-04", net_cents: 10000 }), tx({ payment_id: "c", received_date: "2026-08-31", net_cents: 999999 })],
        [ob({ due_date: "2026-09-20", amount_cents: 900000 })],
      ),
    );
    const max = calendarReceivedMaxCents(septGrid(), totals, inSept);
    expect(max).toBe(40000); // outstanding and out-of-month days don't set the scale
    expect(receivedShadeLevel(40000, max)).toBe(4);
    expect(receivedShadeLevel(10000, max)).toBe(1);
    expect(receivedShadeLevel(10001, max)).toBe(2);
    expect(receivedShadeLevel(0, max)).toBe(0);
    expect(receivedShadeLevel(-500, max)).toBe(0);
    expect(receivedShadeLevel(1, max)).toBe(1); // any real receipt is visible
  });
});

describe("selected-day Received vs Overdue breakdown", () => {
  const ready = { received: "ready" as const, outstanding: "ready" as const };
  const both = { received: true, outstanding: true };
  const day = (txs: RevenueTransaction[], obs: NextPaymentObligation[]) => totalsByDay(entries(txs, obs)).get("2026-09-10") ?? emptyDayTotals();

  it("compares receipts ON the date with the current overdue balance DUE on the date", () => {
    const t = day(
      [tx({ payment_id: "a", net_cents: 5000 }), tx({ payment_id: "b", amount_cents: 10000, net_cents: 8500, refunded_cents: 1500 })],
      [
        ob({ hosting_charge_id: "od", due_date: "2026-09-10", amount_cents: 7000, is_overdue: true, days_relative: -20 }), // partial remainder
        ob({ hosting_charge_id: "sch", due_date: "2026-09-10", amount_cents: 4900, scheduled: true, is_overdue: true, days_relative: -20 }),
        ob({ hosting_charge_id: "other", due_date: "2026-09-11", amount_cents: 99999, is_overdue: true, days_relative: -19 }), // another date
      ],
    );
    expect(selectionBreakdown(t, ready, both)).toEqual({ kind: "chart", receivedCents: 13500, overdueCents: 7000, netAdjustmentCents: 0 });
  });

  it("one positive amount is a single-segment chart; neither is empty; nothing selected prompts", () => {
    expect(selectionBreakdown(day([tx()], []), ready, both)).toEqual({ kind: "chart", receivedCents: 5000, overdueCents: 0, netAdjustmentCents: 0 });
    expect(selectionBreakdown(day([], [ob({ due_date: "2026-09-10", is_overdue: true, days_relative: -3 })]), ready, both)).toEqual({ kind: "chart", receivedCents: 0, overdueCents: 5000, netAdjustmentCents: 0 });
    // A future due date is outstanding, never overdue — no fabricated slice.
    expect(selectionBreakdown(day([], [ob({ due_date: "2026-09-10", days_relative: 4 })]), ready, both)).toEqual({ kind: "empty" });
    expect(selectionBreakdown(day([tx({ voided: true })], []), ready, both)).toEqual({ kind: "empty" });
    expect(selectionBreakdown(null, ready, both)).toEqual({ kind: "select" });
  });

  it("a negative net scope is reported signed, never as a slice", () => {
    const t = day([tx({ payment_id: "neg", amount_cents: 1000, net_cents: -500, refunded_cents: 1500 })], []);
    expect(selectionBreakdown(t, ready, both)).toEqual({ kind: "negative", receivedCents: 0, netAdjustmentCents: -500, netCents: -500, overdueCents: 0 });
  });

  it("regression: one over-refunded payment doesn't turn a positive scope into the no-pie state", () => {
    const t = day([tx({ payment_id: "ok", net_cents: 2000 }), tx({ payment_id: "neg", amount_cents: 1000, net_cents: -500, refunded_cents: 1500 })], []);
    // Charted at its honest net (2000 − 500), with the adjustment kept for the note.
    expect(selectionBreakdown(t, ready, both)).toEqual({ kind: "chart", receivedCents: 1500, overdueCents: 0, netAdjustmentCents: -500 });
  });

  it("unavailable or filtered-out data is never shown as zero", () => {
    const t = day([tx()], []);
    expect(selectionBreakdown(t, { received: "ready", outstanding: "error" }, both)).toEqual({ kind: "unavailable", series: ["overdue"], loading: false });
    expect(selectionBreakdown(t, { received: "loading", outstanding: "ready" }, both)).toEqual({ kind: "unavailable", series: ["received"], loading: true });
    expect(selectionBreakdown(t, ready, { received: true, outstanding: false })).toEqual({ kind: "hidden", series: ["overdue"] });
  });
});

describe("period scope (nothing selected)", () => {
  it("covers exactly the visible month's dates, or the visible week's", () => {
    const sept = calendarPeriodScope(new Date(2026, 8, 15), "month");
    expect(sept.keys.length).toBe(30);
    expect(sept.keys[0]).toBe("2026-09-01");
    expect(sept.keys[29]).toBe("2026-09-30");
    const feb = calendarPeriodScope(new Date(2028, 1, 10), "month"); // leap year
    expect(feb.keys.length).toBe(29);
    const wk = calendarPeriodScope(new Date(2026, 11, 30), "week"); // crosses the year
    expect(wk.keys).toEqual(["2026-12-27", "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  });
});
