import { describe, expect, it } from "vitest";
import { exitStartStyle, shouldPlayOverlayExit } from "./overlayExit";

const CLOSED = { reducedMotion: false, documentHidden: false, stillConnected: false, replaced: false };

describe("shouldPlayOverlayExit", () => {
  it("plays when a drawer really closed", () => {
    expect(shouldPlayOverlayExit(CLOSED)).toBe(true);
  });

  it("closes instantly under reduced motion", () => {
    expect(shouldPlayOverlayExit({ ...CLOSED, reducedMotion: true })).toBe(false);
  });

  it("skips a hidden tab", () => {
    expect(shouldPlayOverlayExit({ ...CLOSED, documentHidden: true })).toBe(false);
  });

  it("ignores a cleanup that didn't remove the drawer", () => {
    expect(shouldPlayOverlayExit({ ...CLOSED, stillConnected: true })).toBe(false);
  });

  it("doesn't leave the old drawer behind one that replaced it", () => {
    expect(shouldPlayOverlayExit({ ...CLOSED, replaced: true })).toBe(false);
  });
});

describe("exitStartStyle", () => {
  it("carries nothing over from a drawer at rest", () => {
    expect(exitStartStyle({ opacity: "1", transform: "none" })).toEqual({ opacity: null, transform: null });
  });

  it("starts from where an interrupted entrance had got to", () => {
    expect(exitStartStyle({ opacity: "0.4", transform: "matrix(1, 0, 0, 1, 9.6, 0)" })).toEqual({
      opacity: "0.4",
      transform: "matrix(1, 0, 0, 1, 9.6, 0)",
    });
    expect(exitStartStyle({ opacity: "0", transform: "none" })).toEqual({ opacity: "0", transform: null });
  });

  it("falls back to rest when there is nothing to read", () => {
    expect(exitStartStyle(null)).toEqual({ opacity: null, transform: null });
    expect(exitStartStyle({ opacity: "", transform: "" })).toEqual({ opacity: null, transform: null });
  });
});
