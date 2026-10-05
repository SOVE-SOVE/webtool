import { describe, expect, it } from "vitest";
import { compactMoney, describeCalendarTotals, exactMoney, scopeDatesLabel, shortDayHeading, describeDayTotals, primaryCents, shortSpanLabel } from "./calendarLabels";
import { emptyDayTotals, type DayTotals } from "./revenueVisuals";

const totals = (o: Partial<DayTotals>): DayTotals => ({ ...emptyDayTotals(), ...o });

describe("describeDayTotals", () => {
  it("says there are no records for an empty or missing day", () => {
    expect(describeDayTotals(undefined, "AUD")).toBe("No records");
    expect(describeDayTotals(emptyDayTotals(), "AUD")).toBe("No records");
  });

  it("phrases overdue as part of outstanding, never as an extra amount", () => {
    const t = totals({ recordCount: 3, receivedCents: 4900, receivedCount: 1, dueCents: 10000, dueCount: 1, overdueCents: 5000, overdueCount: 1 });
    expect(describeDayTotals(t, "AUD")).toBe("Received $49 from 1 payment. Outstanding $150, 2 payments, of which overdue $50");
  });

  it("names refunds/reversals and a negative net without adding them to received", () => {
    const t = totals({ recordCount: 2, adjustedCount: 2, netAdjustmentCents: -1000 });
    expect(describeDayTotals(totals({ recordCount: 1, adjustedCount: 1 }), "AUD")).toBe("1 refund or reversal, not added to received");
    expect(describeDayTotals(t, "AUD")).toBe("2 refunds or reversals, not added to received (net -$10)");
  });
});

describe("compactMoney", () => {
  it("keeps amounts under $1,000 whole and shortens larger ones", () => {
    expect(compactMoney(0, "AUD")).toBe("$0");
    expect(compactMoney(50, "AUD")).toBe("<$1");
    expect(compactMoney(99_900, "AUD")).toBe("$999");
    expect(compactMoney(123_456_789, "AUD")).toBe("$1.2M");
    expect(compactMoney(1_234_567_800, "AUD")).toBe("$12.3M");
  });
});

describe("exactMoney", () => {
  it("shows whole amounts in whole units and keeps the cents of any non-whole amount", () => {
    expect(exactMoney(50, "AUD")).toBe("$0.50");
    expect(exactMoney(-40, "AUD")).toBe("-$0.40");
    expect(exactMoney(100, "AUD")).toBe("$1");
    expect(exactMoney(0, "AUD")).toBe("$0");
    // Regression: non-whole amounts above one unit keep their cents too.
    expect(exactMoney(1234825950, "AUD")).toBe("$12,348,259.50");
    expect(exactMoney(207801, "AUD")).toBe("$2,078.01");
    expect(exactMoney(139800, "AUD")).toBe("$1,398");
    expect(exactMoney(-500, "AUD")).toBe("-$5");
  });
});

describe("shortSpanLabel", () => {
  // en-AU short months: "Sept".
  it("reads naturally within a month, across months and across years", () => {
    expect(shortSpanLabel("2026-09-01", "2026-09-05")).toBe("1–5 Sept");
    expect(shortSpanLabel("2026-08-30", "2026-09-05")).toBe("30 Aug – 5 Sept");
    expect(shortSpanLabel("2026-12-27", "2027-01-02")).toBe("27 Dec 2026 – 2 Jan 2027");
    expect(shortSpanLabel("2026-09-05", "2026-09-05")).toBe("5 Sept");
  });
});

describe("describeCalendarTotals", () => {
  const ready = { received: "ready", outstanding: "ready" } as const;
  it("names the amount the tile shows before the full totals", () => {
    const t = totals({ recordCount: 2, receivedCents: 4900, receivedCount: 1, overdueCents: 5000, overdueCount: 1 });
    expect(describeCalendarTotals(t, "AUD", "received", ready)).toBe(
      "Amount shown: received $49. Received $49 from 1 payment. Outstanding $50, 1 payment, of which overdue $50",
    );
    expect(describeCalendarTotals(t, "AUD", "outstanding", ready)).toMatch(/^Amount shown: outstanding \$50\. /);
  });

  it("says a series is unavailable or loading instead of reading it as zero", () => {
    expect(describeCalendarTotals(undefined, "AUD", "received", { received: "error", outstanding: "ready" })).toBe(
      "Amount shown: received, unavailable. No records",
    );
    expect(describeCalendarTotals(undefined, "AUD", "received", { received: "ready", outstanding: "loading" })).toBe(
      "No records. Outstanding figures still loading",
    );
    // A hidden secondary series isn't mentioned.
    expect(
      describeCalendarTotals(undefined, "AUD", "received", { received: "ready", outstanding: "error" }, { received: true, outstanding: false }),
    ).toBe("No records");
  });

  it("primaryCents follows the view's series", () => {
    const t = totals({ receivedCents: 100, dueCents: 200, overdueCents: 50 });
    expect(primaryCents(t, "received")).toBe(100);
    expect(primaryCents(t, "outstanding")).toBe(250);
    expect(primaryCents(undefined, "outstanding")).toBe(0);
  });
});

describe("panel date labels", () => {
  it("shortDayHeading reads 'Thu, 1 Oct 2026'", () => {
    expect(shortDayHeading("2026-10-01")).toBe("Thu, 1 Oct 2026");
    expect(shortDayHeading("2026-09-10")).toBe("Thu, 10 Sept 2026");
  });
  it("scopeDatesLabel adds the year once, or both years across a year boundary", () => {
    expect(scopeDatesLabel(["2026-10-01"])).toBe("1 Oct 2026");
    expect(scopeDatesLabel(["2026-10-01", "2026-10-31"])).toBe("1–31 Oct 2026");
    expect(scopeDatesLabel(["2026-09-27", "2026-10-03"])).toBe("27 Sept – 3 Oct 2026");
    expect(scopeDatesLabel(["2026-12-27", "2027-01-02"])).toBe("27 Dec 2026 – 2 Jan 2027");
    expect(scopeDatesLabel([])).toBe("");
  });
});
