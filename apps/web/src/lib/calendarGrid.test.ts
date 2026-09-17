import { describe, expect, it } from "vitest";
import {
  addMonths,
  addWeeks,
  calendarPeriodBounds,
  calendarRangeLabel,
  isoToLocalDate,
  monthGrid,
  toDateKey,
  weekGrid,
} from "./calendarGrid";

describe("toDateKey", () => {
  it("pads month and day", () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toDateKey(new Date(2026, 10, 30))).toBe("2026-11-30");
  });
});

describe("isoToLocalDate", () => {
  it("round-trips through toDateKey regardless of local timezone offset", () => {
    expect(toDateKey(isoToLocalDate("2026-02-01"))).toBe("2026-02-01");
    expect(toDateKey(isoToLocalDate("2026-12-31"))).toBe("2026-12-31");
  });
});

describe("monthGrid", () => {
  it("always returns 42 days (6 full Sun-start weeks)", () => {
    expect(monthGrid(2026, 8).length).toBe(42); // September 2026
    expect(monthGrid(2026, 1).length).toBe(42); // February 2026 (short month)
  });

  it("pads with the trailing days of the prior month so the grid starts on Sunday", () => {
    // September 1, 2026 is a Tuesday, so the grid should start on Sunday Aug 30.
    const days = monthGrid(2026, 8);
    expect(toDateKey(days[0])).toBe("2026-08-30");
    expect(days[0].getDay()).toBe(0);
  });

  it("covers every day of the target month", () => {
    const days = monthGrid(2026, 1); // February 2026 — 28 days
    const inMonth = days.filter((d) => d.getMonth() === 1);
    expect(inMonth.length).toBe(28);
  });

  it("spans a year boundary correctly (December)", () => {
    const days = monthGrid(2026, 11);
    expect(toDateKey(days[days.length - 1]).startsWith("2027") || toDateKey(days[days.length - 1]).startsWith("2026")).toBe(
      true,
    );
    const inMonth = days.filter((d) => d.getFullYear() === 2026 && d.getMonth() === 11);
    expect(inMonth.length).toBe(31);
  });
});

describe("weekGrid", () => {
  it("returns 7 days starting on Sunday", () => {
    const days = weekGrid(new Date(2026, 8, 16)); // a Wednesday
    expect(days.length).toBe(7);
    expect(days[0].getDay()).toBe(0);
    expect(toDateKey(days[0])).toBe("2026-09-13");
    expect(toDateKey(days[6])).toBe("2026-09-19");
  });
});

describe("calendarPeriodBounds", () => {
  // The whole point of this function: the reporting period must be the
  // month proper, never the 42-cell grid's padded first/last day, or a
  // total labelled "September 2026" would silently include days of
  // August and October.
  it("returns the calendar month proper, not the padded grid range", () => {
    const bounds = calendarPeriodBounds(new Date(2026, 8, 16), "month");
    expect(bounds).toEqual({ start: "2026-09-01", end: "2026-09-30" });

    const grid = monthGrid(2026, 8);
    expect(toDateKey(grid[0])).toBe("2026-08-30"); // grid really does start in August
    expect(bounds.start).not.toBe(toDateKey(grid[0]));
  });

  it("handles a short month (February, non-leap)", () => {
    expect(calendarPeriodBounds(new Date(2026, 1, 10), "month")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });

  it("handles a leap February", () => {
    expect(calendarPeriodBounds(new Date(2028, 1, 10), "month")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
  });

  it("handles December (year boundary)", () => {
    expect(calendarPeriodBounds(new Date(2026, 11, 25), "month")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
  });

  it("returns the Sun→Sat week in week mode, spanning a month boundary", () => {
    expect(calendarPeriodBounds(new Date(2026, 8, 30), "week")).toEqual({ start: "2026-09-27", end: "2026-10-03" });
  });
});

describe("calendarRangeLabel", () => {
  it("names the month in month mode", () => {
    expect(calendarRangeLabel(new Date(2026, 8, 16), "month")).toContain("2026");
    expect(calendarRangeLabel(new Date(2026, 8, 16), "month")).toMatch(/Sep/i);
  });

  it("spells out both ends in week mode", () => {
    const label = calendarRangeLabel(new Date(2026, 8, 16), "week");
    expect(label).toMatch(/13/);
    expect(label).toMatch(/19/);
  });
});

describe("addMonths / addWeeks", () => {
  it("addMonths always lands on the 1st, handling year rollover", () => {
    const next = addMonths(new Date(2026, 11, 15), 1);
    expect(next.getFullYear()).toBe(2027);
    expect(next.getMonth()).toBe(0);
    expect(next.getDate()).toBe(1);
  });

  it("addWeeks moves by exactly 7 days, handling month rollover", () => {
    const next = addWeeks(new Date(2026, 8, 28), 1);
    expect(toDateKey(next)).toBe("2026-10-05");
  });
});
