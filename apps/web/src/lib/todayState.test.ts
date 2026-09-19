import { describe, expect, it } from "vitest";
import { applyQueryUpdates, monthKey, oneOf, parseMonthKey } from "./todayState";

describe("applyQueryUpdates", () => {
  it("sets, replaces and removes keys while preserving the rest", () => {
    expect(applyQueryUpdates("tab=tasks", { tq: "sunset" })).toBe("tab=tasks&tq=sunset");
    expect(applyQueryUpdates("tab=tasks&tq=a", { tq: "b" })).toBe("tab=tasks&tq=b");
    expect(applyQueryUpdates("tab=tasks&tq=a&cm=2026-10", { tq: null })).toBe("tab=tasks&cm=2026-10");
    expect(applyQueryUpdates("tab=tasks&tq=a", { tq: "" })).toBe("tab=tasks");
  });

  it("encodes awkward search text and round-trips it", () => {
    const q = applyQueryUpdates("", { tq: "a&b=c d" });
    expect(new URLSearchParams(q).get("tq")).toBe("a&b=c d");
  });

  it("is a no-op for an empty update on an empty query", () => {
    expect(applyQueryUpdates("", { tq: null })).toBe("");
  });
});

describe("month keys", () => {
  it("formats and parses a month, including single-digit months and year rollover", () => {
    expect(monthKey(new Date(2026, 8, 19))).toBe("2026-09");
    expect(parseMonthKey("2026-09")).toEqual(new Date(2026, 8, 1));
    expect(parseMonthKey(monthKey(new Date(2027, 0, 31)))).toEqual(new Date(2027, 0, 1));
  });

  it("rejects anything that isn't YYYY-MM", () => {
    for (const bad of [null, "", "2026-13", "2026-00", "2026-9", "26-09", "2026-09-01", "abc"]) {
      expect(parseMonthKey(bad)).toBeNull();
    }
  });
});

describe("oneOf", () => {
  it("keeps allowed values and falls back on unknown or missing ones", () => {
    expect(oneOf("done", ["open", "all", "done"] as const, "open")).toBe("done");
    expect(oneOf("bogus", ["open", "all", "done"] as const, "open")).toBe("open");
    expect(oneOf(null, ["open", "all", "done"] as const, "open")).toBe("open");
  });
});
