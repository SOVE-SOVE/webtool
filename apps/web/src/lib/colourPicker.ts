/**
 * Pure rules behind `components/ui/ColourPicker.tsx` — keyboard steps,
 * hue retention and popover placement — kept DOM-free so they are
 * unit-tested.
 */
import { hexToHsv, type Hex, type Hsv } from "./chartPalette";

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * A typed/reverted HEX → the picker's HSV, keeping what the colour can't
 * express: a grey has no hue and black has no saturation either, so
 * those carry over from `prev` instead of snapping the hue slider to 0
 * (red) or the square's thumb to the left edge.
 */
export function hsvFromHex(hex: Hex, prev: Hsv): Hsv {
  const next = hexToHsv(hex);
  if (next.v === 0) return { h: prev.h, s: prev.s, v: 0 };
  if (next.s === 0) return { h: prev.h, s: 0, v: next.v };
  return next;
}

const SV_STEP = 0.01;
const SV_LARGE_STEP = 0.1;

/**
 * The saturation/brightness square's keyboard model: Left/Right change
 * saturation, Up/Down brightness (1%, or 10% with Shift), Page Up/Down
 * brightness by 10%, Home/End saturation to its ends. Null for any
 * other key, so the caller leaves it alone (Tab, Escape…).
 */
export function stepSv(hsv: Hsv, key: string, large = false): Hsv | null {
  const step = large ? SV_LARGE_STEP : SV_STEP;
  // Rounded to whole percents so repeated steps never drift.
  const round = (v: number) => Math.round(clamp01(v) * 100) / 100;
  switch (key) {
    case "ArrowRight":
      return { ...hsv, s: round(hsv.s + step) };
    case "ArrowLeft":
      return { ...hsv, s: round(hsv.s - step) };
    case "ArrowUp":
      return { ...hsv, v: round(hsv.v + step) };
    case "ArrowDown":
      return { ...hsv, v: round(hsv.v - step) };
    case "PageUp":
      return { ...hsv, v: round(hsv.v + SV_LARGE_STEP) };
    case "PageDown":
      return { ...hsv, v: round(hsv.v - SV_LARGE_STEP) };
    case "Home":
      return { ...hsv, s: 0 };
    case "End":
      return { ...hsv, s: 1 };
    default:
      return null;
  }
}

export const HUE_MAX = 360;

/** The hue slider's keyboard model: arrows ±1° (±10° with Shift), Page
 * Up/Down ±10°, Home/End the two ends. Null for any other key. */
export function stepHue(h: number, key: string, large = false): number | null {
  const step = large ? 10 : 1;
  const clamp = (v: number) => Math.max(0, Math.min(HUE_MAX, Math.round(v)));
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return clamp(h + step);
    case "ArrowLeft":
    case "ArrowDown":
      return clamp(h - step);
    case "PageUp":
      return clamp(h + 10);
    case "PageDown":
      return clamp(h - 10);
    case "Home":
      return 0;
    case "End":
      return HUE_MAX;
    default:
      return null;
  }
}

/** A word for a hue, so the slider's spoken value isn't only a number. */
export function hueName(h: number): string {
  const hue = ((h % 360) + 360) % 360;
  if (hue < 15) return "red";
  if (hue < 45) return "orange";
  if (hue < 70) return "yellow";
  if (hue < 165) return "green";
  if (hue < 200) return "cyan";
  if (hue < 260) return "blue";
  if (hue < 290) return "purple";
  if (hue < 345) return "pink";
  return "red";
}

export type PopoverPlacement = { top: number; left: number; maxHeight: number; side: "below" | "above" };

/**
 * Where an anchored panel goes (viewport coordinates): below the anchor
 * and lined up with its left edge; flipped above when it doesn't fit
 * below and there is more room above; shifted sideways to stay `margin`
 * px inside the viewport. When neither side fits it whole it slides
 * along the anchor (covering it) rather than shrinking, so every control
 * stays on screen; only a viewport shorter than the panel caps its
 * height (the panel then scrolls).
 */
export function placePopover({
  anchor,
  panel,
  viewport,
  gap = 8,
  margin = 8,
}: {
  anchor: { top: number; bottom: number; left: number };
  panel: { width: number; height: number };
  viewport: { width: number; height: number };
  gap?: number;
  margin?: number;
}): PopoverPlacement {
  const spaceBelow = viewport.height - anchor.bottom - gap - margin;
  const spaceAbove = anchor.top - gap - margin;
  const below = panel.height <= spaceBelow || spaceBelow >= spaceAbove;
  const maxHeight = Math.min(panel.height, Math.max(viewport.height - 2 * margin, 0));
  const preferredTop = below ? anchor.bottom + gap : anchor.top - gap - maxHeight;
  const maxLeft = viewport.width - panel.width - margin;
  return {
    // The top/left margin wins when the panel is larger than the viewport allows.
    top: Math.max(Math.min(preferredTop, viewport.height - margin - maxHeight), margin),
    left: Math.max(Math.min(anchor.left, maxLeft), margin),
    maxHeight,
    side: below ? "below" : "above",
  };
}
