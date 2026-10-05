/**
 * Pure rules behind `components/ui/Tooltip.tsx` — where the bubble goes,
 * how long a hover waits, and which pointers get one at all — kept
 * DOM-free so they are unit-tested.
 *
 * Not `placePopover` (lib/colourPicker.ts): that one lines a panel up
 * with its anchor's left edge, always tries below first, and slides over
 * the anchor when it fits on neither side. A tooltip is centred on its
 * control, has a preferred side, and must never cover the control.
 */
export type TooltipSide = "top" | "bottom";
export type TooltipPlacement = { top: number; left: number; side: TooltipSide };

/**
 * Viewport coordinates for a bubble centred on `anchor` on the preferred
 * `side`; flipped to the other side when it doesn't fit there and the
 * other side has more room; shifted sideways to stay `margin` px inside
 * the viewport (the left margin wins when the bubble is wider than that).
 */
export function placeTooltip({
  anchor,
  tip,
  viewport,
  side = "top",
  gap = 6,
  margin = 8,
}: {
  anchor: { top: number; bottom: number; left: number; right: number };
  tip: { width: number; height: number };
  viewport: { width: number; height: number };
  side?: TooltipSide;
  gap?: number;
  margin?: number;
}): TooltipPlacement {
  const spaceAbove = anchor.top - gap - margin;
  const spaceBelow = viewport.height - anchor.bottom - gap - margin;
  const preferred = side === "top" ? spaceAbove : spaceBelow;
  const other = side === "top" ? spaceBelow : spaceAbove;
  const flip = tip.height > preferred && other > preferred;
  const placed: TooltipSide = flip ? (side === "top" ? "bottom" : "top") : side;
  const centre = (anchor.left + anchor.right) / 2;
  const maxLeft = viewport.width - tip.width - margin;
  return {
    top: Math.round(placed === "top" ? anchor.top - gap - tip.height : anchor.bottom + gap),
    left: Math.round(Math.max(Math.min(centre - tip.width / 2, maxLeft), margin)),
    side: placed,
  };
}

/** How long a hover rests on a control before its tooltip shows. */
export const TOOLTIP_HOVER_DELAY_MS = 400;
/** Moving on to another tooltipped control within this long of the last
 * tooltip closing skips the delay — scanning a toolbar reads as one. */
export const TOOLTIP_WARM_MS = 300;

export function tooltipHoverDelay(now: number, lastHiddenAt: number | null): number {
  return lastHiddenAt !== null && now - lastHiddenAt < TOOLTIP_WARM_MS ? 0 : TOOLTIP_HOVER_DELAY_MS;
}

/** Hover tooltips are for a pointer that can hover: never a finger. */
export function pointerShowsTooltip(pointerType: string): boolean {
  return pointerType === "mouse" || pointerType === "pen";
}
