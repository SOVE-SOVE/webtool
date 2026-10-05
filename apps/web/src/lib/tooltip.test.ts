import { describe, expect, it } from "vitest";
import { placeTooltip, pointerShowsTooltip, tooltipHoverDelay, TOOLTIP_HOVER_DELAY_MS } from "./tooltip";

const viewport = { width: 1280, height: 800 };
const tip = { width: 80, height: 24 };

describe("placeTooltip", () => {
  it("centres above the control by default", () => {
    const p = placeTooltip({ anchor: { top: 400, bottom: 432, left: 600, right: 632 }, tip, viewport });
    expect(p).toEqual({ top: 400 - 6 - 24, left: 616 - 40, side: "top" });
  });

  it("flips below when there is no room above (top bar)", () => {
    const p = placeTooltip({ anchor: { top: 8, bottom: 40, left: 600, right: 632 }, tip, viewport });
    expect(p.side).toBe("bottom");
    expect(p.top).toBe(46);
  });

  it("flips above when a bottom tooltip would leave the viewport (bottom nav)", () => {
    const p = placeTooltip({ anchor: { top: 750, bottom: 790, left: 600, right: 632 }, tip, viewport, side: "bottom" });
    expect(p.side).toBe("top");
    expect(p.top).toBe(750 - 6 - 24);
  });

  it("keeps the preferred side when neither fits and it has more room", () => {
    const p = placeTooltip({ anchor: { top: 20, bottom: 30, left: 0, right: 10 }, tip, viewport: { width: 200, height: 50 } });
    expect(p.side).toBe("top");
  });

  it("shifts in from the right edge", () => {
    const p = placeTooltip({ anchor: { top: 400, bottom: 432, left: 1244, right: 1276 }, tip, viewport });
    expect(p.left).toBe(1280 - 80 - 8);
  });

  it("shifts in from the left edge", () => {
    const p = placeTooltip({ anchor: { top: 400, bottom: 432, left: 4, right: 36 }, tip, viewport });
    expect(p.left).toBe(8);
  });

  it("pins a bubble wider than the viewport to the left margin", () => {
    const p = placeTooltip({ anchor: { top: 400, bottom: 432, left: 100, right: 132 }, tip: { width: 400, height: 24 }, viewport: { width: 390, height: 800 } });
    expect(p.left).toBe(8);
  });

  it("never overlaps the control vertically", () => {
    const anchor = { top: 300, bottom: 340, left: 100, right: 140 };
    const above = placeTooltip({ anchor, tip, viewport });
    expect(above.top + tip.height).toBeLessThanOrEqual(anchor.top);
    const below = placeTooltip({ anchor, tip, viewport, side: "bottom" });
    expect(below.top).toBeGreaterThanOrEqual(anchor.bottom);
  });
});

describe("tooltipHoverDelay", () => {
  it("waits the full delay on a cold hover", () => {
    expect(tooltipHoverDelay(1000, null)).toBe(TOOLTIP_HOVER_DELAY_MS);
    expect(tooltipHoverDelay(5000, 1000)).toBe(TOOLTIP_HOVER_DELAY_MS);
  });

  it("skips the delay straight after another tooltip closed", () => {
    expect(tooltipHoverDelay(1100, 1000)).toBe(0);
  });
});

describe("pointerShowsTooltip", () => {
  it("is for hovering pointers only", () => {
    expect(pointerShowsTooltip("mouse")).toBe(true);
    expect(pointerShowsTooltip("pen")).toBe(true);
    expect(pointerShowsTooltip("touch")).toBe(false);
    expect(pointerShowsTooltip("")).toBe(false);
  });
});
