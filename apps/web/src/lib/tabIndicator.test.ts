import { describe, expect, it } from "vitest";
import { nextIndicator, sameRect, travelOrigin, TRAVEL_MAX_AGE_MS, type IndicatorState } from "./tabIndicator";

describe("nextIndicator", () => {
  it("appears in place on the first measurement", () => {
    expect(nextIndicator(null, { left: 40, width: 60 }, "b")).toEqual({ left: 40, width: 60, tabId: "b", animate: false });
  });

  it("travels when a different tab becomes active", () => {
    const prev: IndicatorState = { left: 0, width: 50, tabId: "a", animate: false };
    expect(nextIndicator(prev, { left: 66, width: 80 }, "b")).toEqual({ left: 66, width: 80, tabId: "b", animate: true });
  });

  it("follows at once when the same tab's box changes (count loaded, font swapped, resize)", () => {
    const prev: IndicatorState = { left: 66, width: 80, tabId: "b", animate: true };
    expect(nextIndicator(prev, { left: 66, width: 96 }, "b")).toEqual({ left: 66, width: 96, tabId: "b", animate: false });
    expect(nextIndicator(prev, { left: 70, width: 80 }, "b").animate).toBe(false);
  });

  it("returns the previous state itself when nothing changed", () => {
    const prev: IndicatorState = { left: 66, width: 80, tabId: "b", animate: true };
    expect(nextIndicator(prev, { left: 66, width: 80 }, "b")).toBe(prev);
  });

  it("travels even when the new tab has the same box as the old one", () => {
    const prev: IndicatorState = { left: 0, width: 50, tabId: "a", animate: false };
    expect(nextIndicator(prev, { left: 0, width: 50 }, "b")).toEqual({ left: 0, width: 50, tabId: "b", animate: true });
  });
});

describe("travelOrigin", () => {
  const memory = { tabId: "planning", rect: { left: 0, width: 62 }, at: 1000 };

  it("starts from where the previous instance left the underline", () => {
    expect(travelOrigin(memory, "projects", 1010)).toEqual({ left: 0, width: 62 });
  });

  it("appears in place with nothing remembered (first load)", () => {
    expect(travelOrigin(undefined, "projects", 1010)).toBeNull();
  });

  it("appears in place when the same tab is active again", () => {
    expect(travelOrigin(memory, "planning", 1010)).toBeNull();
  });

  it("ignores a position left behind by an earlier visit", () => {
    expect(travelOrigin(memory, "projects", 1000 + TRAVEL_MAX_AGE_MS)).not.toBeNull();
    expect(travelOrigin(memory, "projects", 1000 + TRAVEL_MAX_AGE_MS + 1)).toBeNull();
    expect(travelOrigin(memory, "projects", 999)).toBeNull();
  });

  it("ignores a position measured while the bar was hidden", () => {
    expect(travelOrigin({ ...memory, rect: { left: 0, width: 0 } }, "projects", 1010)).toBeNull();
  });
});

describe("sameRect", () => {
  it("compares left and width", () => {
    expect(sameRect({ left: 1, width: 2 }, { left: 1, width: 2 })).toBe(true);
    expect(sameRect({ left: 1, width: 2 }, { left: 1, width: 3 })).toBe(false);
    expect(sameRect({ left: 0, width: 2 }, { left: 1, width: 2 })).toBe(false);
  });
});
