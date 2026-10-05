import { describe, expect, it } from "vitest";
import { planFlip, sameSpot, shiftRects, translationOf, type FlipRect } from "./layoutFlip";

const viewport = { width: 1000, height: 800 };
const rect = (left: number, top: number): FlipRect => ({ left, top, width: 100, height: 50 });
const map = (entries: [string, FlipRect][]) => new Map(entries);

describe("planFlip", () => {
  it("does nothing on the first measurement (no entrance replay on load)", () => {
    expect(planFlip(null, map([["a", rect(0, 0)]]), viewport)).toEqual({ moves: [], entered: [] });
  });

  it("moves items from their old place and reports new ones", () => {
    const prev = map([["a", rect(0, 0)], ["b", rect(120, 0)]]);
    const next = map([["b", rect(0, 0)], ["c", rect(120, 0)]]);
    expect(planFlip(prev, next, viewport)).toEqual({ moves: [{ key: "b", dx: 120, dy: 0 }], entered: ["c"] });
  });

  it("ignores items that didn't move, or moved less than the threshold", () => {
    const prev = map([["a", rect(0, 0)], ["b", rect(120, 0)]]);
    const next = map([["a", rect(0, 0)], ["b", rect(121, 0)]]);
    expect(planFlip(prev, next, viewport).moves).toEqual([]);
  });

  it("skips items that are off screen both before and after", () => {
    const prev = map([["a", rect(0, 2000)], ["b", rect(0, 2000)], ["c", rect(0, 100)]]);
    const next = map([["a", rect(0, 2400)], ["b", rect(0, 100)], ["c", rect(0, 2400)]]);
    expect(planFlip(prev, next, viewport).moves.map((m) => m.key)).toEqual(["b", "c"]);
  });

  it("doesn't count an off-screen new item as entered", () => {
    expect(planFlip(map([]), map([["a", rect(0, 5000)]]), viewport).entered).toEqual([]);
  });

  it("starts an item arriving from off screen at the viewport edge when asked to", () => {
    // Far below the fold → the top row; far right and above → the middle.
    const prev = map([["a", rect(0, 3000)], ["b", rect(5000, -900)], ["c", rect(0, 100)]]);
    const next = map([["a", rect(0, 100)], ["b", rect(300, 300)], ["c", rect(0, 3000)]]);
    // Default: the full distance, exactly as before the option existed.
    expect(planFlip(prev, next, viewport).moves).toEqual([
      { key: "a", dx: 0, dy: 2900 },
      { key: "b", dx: 4700, dy: -1200 },
      { key: "c", dx: 0, dy: -2900 },
    ]);
    expect(planFlip(prev, next, viewport, { clampToViewport: true }).moves).toEqual([
      { key: "a", dx: 0, dy: 700 }, // from top = viewport height (800)
      { key: "b", dx: 700, dy: -350 }, // from left = viewport width (1000), top = -its height (-50)
      { key: "c", dx: 0, dy: -2900 }, // was on screen: starts where it visibly was
    ]);
  });

  it("leaves on-screen moves alone when clamping", () => {
    const prev = map([["a", rect(0, 0)], ["b", rect(880, 700)]]);
    const next = map([["a", rect(880, 700)], ["b", rect(0, 0)]]);
    expect(planFlip(prev, next, viewport, { clampToViewport: true })).toEqual(planFlip(prev, next, viewport));
  });

  it("can ignore the same items merely shifting (late data resizing a row)", () => {
    const prev = map([["a", rect(0, 0)], ["b", rect(0, 60)], ["c", rect(0, 120)]]);
    const taller = map([["a", rect(0, 0)], ["b", rect(0, 90)], ["c", rect(0, 150)]]);
    expect(planFlip(prev, taller, viewport).moves).toHaveLength(2); // default: unchanged
    expect(planFlip(prev, taller, viewport, { onlyWhenKeysChange: true })).toEqual({ moves: [], entered: [] });
    // Reordered, removed or added: animates as usual.
    const reordered = map([["b", rect(0, 0)], ["a", rect(0, 60)], ["c", rect(0, 120)]]);
    expect(planFlip(prev, reordered, viewport, { onlyWhenKeysChange: true }).moves.map((m) => m.key)).toEqual(["b", "a"]);
    const removed = map([["b", rect(0, 0)], ["c", rect(0, 60)]]);
    expect(planFlip(prev, removed, viewport, { onlyWhenKeysChange: true }).moves.map((m) => m.key)).toEqual(["b", "c"]);
    const added = map([["z", rect(0, 0)], ["a", rect(0, 60)], ["b", rect(0, 120)], ["c", rect(0, 180)]]);
    const plan = planFlip(prev, added, viewport, { onlyWhenKeysChange: true });
    expect(plan.entered).toEqual(["z"]);
    expect(plan.moves).toHaveLength(3);
  });

  it("skips the whole animation when too many items move", () => {
    const prev = map(Array.from({ length: 5 }, (_, i) => [`k${i}`, rect(i * 110, 0)] as [string, FlipRect]));
    const next = map(Array.from({ length: 5 }, (_, i) => [`k${i}`, rect(i * 110, 60)] as [string, FlipRect]));
    expect(planFlip(prev, next, viewport, { maxMoves: 4 }).moves).toEqual([]);
    expect(planFlip(prev, next, viewport, { maxMoves: 5 }).moves).toHaveLength(5);
  });
});

describe("shiftRects", () => {
  it("cancels scrolling between measurements", () => {
    const prev = map([["a", rect(0, 300)]]);
    // The page scrolled down 200px: the same item now measures 200px higher.
    const next = map([["a", rect(0, 100)]]);
    expect(planFlip(shiftRects(prev, 0, -200), next, viewport).moves).toEqual([]);
  });
});

describe("translationOf", () => {
  it("reads a plain translation, and treats no transform as no movement", () => {
    expect(translationOf("none")).toEqual({ x: 0, y: 0 });
    expect(translationOf("matrix(1, 0, 0, 1, 12.5, -40)")).toEqual({ x: 12.5, y: -40 });
  });

  it("refuses anything that isn't a plain translation", () => {
    expect(translationOf("matrix(0.98, 0, 0, 0.98, 0, 0)")).toBeNull();
    expect(translationOf("matrix(0, 1, -1, 0, 5, 5)")).toBeNull();
    expect(translationOf("matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 5, 0, 1)")).toBeNull();
  });
});

describe("sameSpot", () => {
  it("ignores sub-pixel differences but not real movement", () => {
    expect(sameSpot(rect(10, 10), rect(10.4, 9.7))).toBe(true);
    expect(sameSpot(rect(10, 10), rect(10, 12))).toBe(false);
  });
});
