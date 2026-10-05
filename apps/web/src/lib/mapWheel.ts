/**
 * Trackpad gesture maths for the Discovery map (components/DiscoveryMap.tsx).
 * Pure, so the rules are unit-tested; the component owns the listeners.
 *
 * - A plain wheel event (two-finger scroll, or a mouse wheel) PANS.
 * - A pinch ZOOMS. Chrome/Firefox/Edge report a trackpad pinch as wheel
 *   events with `ctrlKey` set; Safari reports it as non-standard
 *   `gesturechange` events carrying a cumulative `scale` instead.
 */

export type WheelLike = { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; shiftKey?: boolean };

const LINE_HEIGHT_PX = 16;

/** True when the event is a pinch (or Ctrl + wheel), which zooms rather than pans. */
export function isPinchWheel(e: WheelLike): boolean {
  return e.ctrlKey;
}

/**
 * How far to move the view, in CSS pixels, for one wheel event — the
 * same direction a page would scroll, so it follows the system's
 * trackpad setting. `deltaMode` 1 is lines (mouse wheels in Firefox), 2
 * is pages. Shift + a vertical-only wheel pans sideways, as browsers do
 * for horizontal scrolling with a mouse.
 */
export function wheelPanDelta(e: WheelLike, pageSize: { width: number; height: number }): { dx: number; dy: number } {
  const unitX = e.deltaMode === 1 ? LINE_HEIGHT_PX : e.deltaMode === 2 ? pageSize.width : 1;
  const unitY = e.deltaMode === 1 ? LINE_HEIGHT_PX : e.deltaMode === 2 ? pageSize.height : 1;
  let dx = e.deltaX * unitX;
  let dy = e.deltaY * unitY;
  if (e.shiftKey && dx === 0) {
    dx = dy;
    dy = 0;
  }
  return { dx, dy };
}

/** Accumulated pinch distance (in wheel pixels) that makes one zoom level. */
export const PINCH_PX_PER_ZOOM_LEVEL = 50;

/**
 * Wheel-pinch accumulator: adds this event's delta and reports how many
 * whole zoom levels to apply now (positive = zoom in; pinch-out gives a
 * negative deltaY), keeping the remainder for the next event. Whole
 * levels only — the map's tiles are drawn at integer zooms.
 */
export function accumulatePinch(accumulated: number, deltaY: number): { steps: number; remainder: number } {
  const total = accumulated - deltaY;
  const steps = Math.trunc(total / PINCH_PX_PER_ZOOM_LEVEL) || 0; // never -0
  return { steps, remainder: total - steps * PINCH_PX_PER_ZOOM_LEVEL };
}

/** Safari gesture events: the zoom level a cumulative pinch `scale`
 * (1 = unchanged, 2 = twice as large) corresponds to, from the zoom the
 * gesture started at. Rounded to a whole level and kept within limits. */
export function zoomForGestureScale(startZoom: number, scale: number, minZoom: number, maxZoom: number): number {
  if (!(scale > 0) || !Number.isFinite(scale)) return startZoom;
  return Math.max(minZoom, Math.min(maxZoom, Math.round(startZoom + Math.log2(scale))));
}
