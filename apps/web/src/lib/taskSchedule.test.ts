import { describe, expect, it } from "vitest";
import { compactMonthCells, indexScheduleByDay, scheduleDateKey } from "./taskSchedule";
import { toDateKey } from "./calendarGrid";

describe("scheduleDateKey", () => {
  it("passes a plain date through untouched", () => {
    expect(scheduleDateKey("2026-09-19")).toBe("2026-09-19");
  });

  it("places a datetime on its local day", () => {
    const local = new Date(2026, 8, 19, 23, 30);
    expect(scheduleDateKey(local.toISOString())).toBe(toDateKey(local));
  });

  it("returns null for an unparseable value", () => {
    expect(scheduleDateKey("not a date")).toBeNull();
  });
});

describe("compactMonthCells", () => {
  it("draws only the weeks the month touches", () => {
    // Feb 2026 starts on a Sunday and has 28 days: exactly 4 rows.
    expect(compactMonthCells(2026, 1)).toHaveLength(28);
    // Sept 2026 starts on a Tuesday, 30 days: 5 rows.
    expect(compactMonthCells(2026, 8)).toHaveLength(35);
    // Aug 2026 starts on a Saturday, 31 days: 6 rows.
    expect(compactMonthCells(2026, 7)).toHaveLength(42);
  });

  it("starts on a Sunday and includes every day of the month", () => {
    const cells = compactMonthCells(2026, 8);
    expect(cells[0].getDay()).toBe(0);
    const inMonth = cells.filter((d) => d.getMonth() === 8).map((d) => d.getDate());
    expect(inMonth).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });
});

describe("indexScheduleByDay", () => {
  it("buckets each source separately by day", () => {
    const byDay = indexScheduleByDay(
      [{ id: "task:1", title: "Send proofs", at: "2026-09-20" }],
      [{ id: "meeting:1", title: "Check-in", at: "2026-09-20" }],
    );
    expect(byDay.get("2026-09-20")?.task.map((e) => e.title)).toEqual(["Send proofs"]);
    expect(byDay.get("2026-09-20")?.client.map((e) => e.title)).toEqual(["Check-in"]);
  });

  it("keeps an item present in both sources once, under the task source", () => {
    const byDay = indexScheduleByDay(
      [{ id: "task:1", title: "Send proofs", at: "2026-09-20" }],
      [{ id: "task:1", title: "Send proofs", at: "2026-09-20" }],
    );
    expect(byDay.get("2026-09-20")).toEqual({
      task: [{ id: "task:1", title: "Send proofs", at: "2026-09-20" }],
      client: [],
    });
  });

  it("drops duplicate ids within one source and skips bad dates", () => {
    const byDay = indexScheduleByDay(
      [],
      [
        { id: "meeting:1", title: "A", at: "2026-09-01" },
        { id: "meeting:1", title: "A", at: "2026-09-01" },
        { id: "meeting:2", title: "B", at: "garbage" },
      ],
    );
    expect(byDay.size).toBe(1);
    expect(byDay.get("2026-09-01")?.client).toHaveLength(1);
  });

  it("returns an empty map for no events", () => {
    expect(indexScheduleByDay([], []).size).toBe(0);
  });
});
