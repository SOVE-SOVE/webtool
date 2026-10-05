import { describe, expect, it } from "vitest";
import { accumulatePinch, isPinchWheel, PINCH_PX_PER_ZOOM_LEVEL, wheelPanDelta, zoomForGestureScale } from "./mapWheel";

const page = { width: 1200, height: 800 };
const wheel = (o: Partial<Parameters<typeof wheelPanDelta>[0]>) => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, ...o });

describe("wheelPanDelta", () => {
  it("pans by the pixel deltas, vertically, horizontally and diagonally", () => {
    expect(wheelPanDelta(wheel({ deltaY: 12 }), page)).toEqual({ dx: 0, dy: 12 });
    expect(wheelPanDelta(wheel({ deltaX: -7 }), page)).toEqual({ dx: -7, dy: 0 });
    expect(wheelPanDelta(wheel({ deltaX: 3.5, deltaY: -4.25 }), page)).toEqual({ dx: 3.5, dy: -4.25 });
  });

  it("converts line and page modes to pixels", () => {
    expect(wheelPanDelta(wheel({ deltaY: 3, deltaMode: 1 }), page)).toEqual({ dx: 0, dy: 48 });
    expect(wheelPanDelta(wheel({ deltaX: 1, deltaY: 1, deltaMode: 2 }), page)).toEqual({ dx: 1200, dy: 800 });
  });

  it("treats Shift + vertical wheel as horizontal, but leaves a real horizontal delta alone", () => {
    expect(wheelPanDelta(wheel({ deltaY: 20, shiftKey: true }), page)).toEqual({ dx: 20, dy: 0 });
    expect(wheelPanDelta(wheel({ deltaX: 5, deltaY: 20, shiftKey: true }), page)).toEqual({ dx: 5, dy: 20 });
  });
});

describe("pinch", () => {
  it("is identified by ctrlKey only", () => {
    expect(isPinchWheel(wheel({ deltaY: 5, ctrlKey: true }))).toBe(true);
    expect(isPinchWheel(wheel({ deltaY: 500 }))).toBe(false);
  });

  it("accumulates small deltas into whole zoom levels and keeps the remainder", () => {
    let acc = 0;
    let steps = 0;
    for (let i = 0; i < 12; i++) {
      const r = accumulatePinch(acc, -10); // pinch out: negative deltaY = zoom in
      acc = r.remainder;
      steps += r.steps;
    }
    expect(steps).toBe(2);
    expect(acc).toBe(120 - 2 * PINCH_PX_PER_ZOOM_LEVEL);
  });

  it("zooms out for positive deltas and never steps on a tiny movement", () => {
    expect(accumulatePinch(0, 60)).toEqual({ steps: -1, remainder: -10 });
    expect(accumulatePinch(0, 3)).toEqual({ steps: 0, remainder: -3 });
    // Reversing direction first uses up what was accumulated.
    expect(accumulatePinch(40, 30)).toEqual({ steps: 0, remainder: 10 });
  });
});

describe("zoomForGestureScale", () => {
  it("maps a cumulative scale to whole zoom levels from the starting zoom", () => {
    expect(zoomForGestureScale(10, 1, 0, 19)).toBe(10);
    expect(zoomForGestureScale(10, 1.2, 0, 19)).toBe(10);
    expect(zoomForGestureScale(10, 2, 0, 19)).toBe(11);
    expect(zoomForGestureScale(10, 4.1, 0, 19)).toBe(12);
    expect(zoomForGestureScale(10, 0.5, 0, 19)).toBe(9);
  });

  it("stays within the map's limits and ignores nonsense", () => {
    expect(zoomForGestureScale(18, 8, 0, 19)).toBe(19);
    expect(zoomForGestureScale(1, 0.1, 0, 19)).toBe(0);
    expect(zoomForGestureScale(7, 0, 0, 19)).toBe(7);
    expect(zoomForGestureScale(7, NaN, 0, 19)).toBe(7);
  });
});
