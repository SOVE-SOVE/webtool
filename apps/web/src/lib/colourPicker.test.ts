import { describe, expect, it } from "vitest";
import { hsvToHex } from "./chartPalette";
import { clamp01, hsvFromHex, hueName, placePopover, stepHue, stepSv } from "./colourPicker";

describe("clamp01", () => {
  it("clamps to 0–1", () => {
    expect(clamp01(-0.2)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(1.7)).toBe(1);
  });
});

describe("hsvFromHex", () => {
  const prev = { h: 210, s: 0.6, v: 0.8 };

  it("uses the colour's own hue when it has one", () => {
    const next = hsvFromHex("#ff0000", prev);
    expect(next).toEqual({ h: 0, s: 1, v: 1 });
  });

  it("keeps the previous hue for a grey", () => {
    const next = hsvFromHex("#808080", prev);
    expect(next.h).toBe(210);
    expect(next.s).toBe(0);
    expect(hsvToHex(next)).toBe("#808080");
  });

  it("keeps the previous hue and saturation for black", () => {
    const next = hsvFromHex("#000000", prev);
    expect(next).toEqual({ h: 210, s: 0.6, v: 0 });
    expect(hsvToHex(next)).toBe("#000000");
  });

  it("keeps the previous hue for white", () => {
    expect(hsvFromHex("#ffffff", prev)).toEqual({ h: 210, s: 0, v: 1 });
  });
});

describe("stepSv", () => {
  const hsv = { h: 120, s: 0.5, v: 0.5 };

  it("moves saturation with Left/Right and brightness with Up/Down", () => {
    expect(stepSv(hsv, "ArrowRight")).toEqual({ h: 120, s: 0.51, v: 0.5 });
    expect(stepSv(hsv, "ArrowLeft")).toEqual({ h: 120, s: 0.49, v: 0.5 });
    expect(stepSv(hsv, "ArrowUp")).toEqual({ h: 120, s: 0.5, v: 0.51 });
    expect(stepSv(hsv, "ArrowDown")).toEqual({ h: 120, s: 0.5, v: 0.49 });
  });

  it("takes 10% steps with Shift and with Page Up/Down", () => {
    expect(stepSv(hsv, "ArrowRight", true)?.s).toBe(0.6);
    expect(stepSv(hsv, "ArrowDown", true)?.v).toBe(0.4);
    expect(stepSv(hsv, "PageUp")?.v).toBe(0.6);
    expect(stepSv(hsv, "PageDown")?.v).toBe(0.4);
  });

  it("jumps saturation to its ends with Home/End", () => {
    expect(stepSv(hsv, "Home")?.s).toBe(0);
    expect(stepSv(hsv, "End")?.s).toBe(1);
  });

  it("stays inside 0–1 and never changes the hue", () => {
    expect(stepSv({ h: 120, s: 1, v: 1 }, "ArrowRight", true)).toEqual({ h: 120, s: 1, v: 1 });
    expect(stepSv({ h: 120, s: 0, v: 0 }, "ArrowDown")).toEqual({ h: 120, s: 0, v: 0 });
  });

  it("does not drift over repeated steps", () => {
    let cur = { h: 0, s: 0, v: 0.5 };
    for (let i = 0; i < 100; i++) cur = stepSv(cur, "ArrowRight")!;
    expect(cur.s).toBe(1);
  });

  it("ignores other keys", () => {
    expect(stepSv(hsv, "Tab")).toBeNull();
    expect(stepSv(hsv, "Escape")).toBeNull();
    expect(stepSv(hsv, "a")).toBeNull();
  });
});

describe("stepHue", () => {
  it("steps by 1°, or 10° when large", () => {
    expect(stepHue(100, "ArrowRight")).toBe(101);
    expect(stepHue(100, "ArrowUp")).toBe(101);
    expect(stepHue(100, "ArrowLeft")).toBe(99);
    expect(stepHue(100, "ArrowDown")).toBe(99);
    expect(stepHue(100, "ArrowRight", true)).toBe(110);
    expect(stepHue(100, "PageDown")).toBe(90);
    expect(stepHue(100, "PageUp")).toBe(110);
  });

  it("clamps at the ends and supports Home/End", () => {
    expect(stepHue(0, "ArrowLeft")).toBe(0);
    expect(stepHue(360, "ArrowRight")).toBe(360);
    expect(stepHue(355, "ArrowRight", true)).toBe(360);
    expect(stepHue(200, "Home")).toBe(0);
    expect(stepHue(200, "End")).toBe(360);
  });

  it("ignores other keys", () => {
    expect(stepHue(100, "Tab")).toBeNull();
    expect(stepHue(100, "Enter")).toBeNull();
  });
});

describe("hueName", () => {
  it("names the main hue bands, wrapping at 360", () => {
    expect(hueName(0)).toBe("red");
    expect(hueName(30)).toBe("orange");
    expect(hueName(60)).toBe("yellow");
    expect(hueName(120)).toBe("green");
    expect(hueName(180)).toBe("cyan");
    expect(hueName(240)).toBe("blue");
    expect(hueName(275)).toBe("purple");
    expect(hueName(320)).toBe("pink");
    expect(hueName(360)).toBe("red");
  });
});

describe("placePopover", () => {
  const panel = { width: 256, height: 340 };

  it("opens below, aligned to the anchor's left edge, when it fits", () => {
    const p = placePopover({ anchor: { top: 100, bottom: 144, left: 300 }, panel, viewport: { width: 1280, height: 800 } });
    expect(p).toEqual({ top: 152, left: 300, maxHeight: 340, side: "below" });
  });

  it("flips above when there is no room below but more above", () => {
    const p = placePopover({ anchor: { top: 600, bottom: 644, left: 300 }, panel, viewport: { width: 1280, height: 800 } });
    expect(p.side).toBe("above");
    expect(p.top).toBe(600 - 8 - 340);
    expect(p.maxHeight).toBe(340);
  });

  it("shifts left to stay inside a narrow viewport", () => {
    const p = placePopover({ anchor: { top: 100, bottom: 144, left: 200 }, panel, viewport: { width: 375, height: 800 } });
    expect(p.left).toBe(375 - 256 - 8);
    expect(p.left + panel.width).toBeLessThanOrEqual(375 - 8);
  });

  it("never goes past the left margin, even when the panel is too wide", () => {
    const p = placePopover({ anchor: { top: 100, bottom: 144, left: -40 }, panel: { width: 400, height: 200 }, viewport: { width: 320, height: 800 } });
    expect(p.left).toBe(8);
  });

  it("slides over the anchor, at full height, when neither side fits it whole", () => {
    const p = placePopover({ anchor: { top: 180, bottom: 224, left: 20 }, panel, viewport: { width: 375, height: 400 } });
    // below: 400 - 224 - 16 = 160; above: 180 - 16 = 164 → above, then clamped to the top margin.
    expect(p.side).toBe("above");
    expect(p.maxHeight).toBe(340);
    expect(p.top).toBe(8);
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(400 - 8);
  });

  it("keeps the bottom edge inside the viewport when opening below without room", () => {
    const p = placePopover({ anchor: { top: 150, bottom: 194, left: 20 }, panel, viewport: { width: 375, height: 420 } });
    // below: 420 - 194 - 16 = 210; above: 150 - 16 = 134 → below, pulled up to fit.
    expect(p.side).toBe("below");
    expect(p.top).toBe(420 - 8 - 340);
    expect(p.maxHeight).toBe(340);
  });

  it("caps the height only when the viewport itself is too short", () => {
    const p = placePopover({ anchor: { top: 100, bottom: 144, left: 20 }, panel, viewport: { width: 375, height: 300 } });
    expect(p.maxHeight).toBe(300 - 16);
    expect(p.top).toBe(8);
  });

  it("never returns a negative height", () => {
    const p = placePopover({ anchor: { top: 0, bottom: 44, left: 0 }, panel, viewport: { width: 320, height: 10 } });
    expect(p.maxHeight).toBe(0);
  });
});
