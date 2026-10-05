/**
 * Layout ("FLIP") transition planning — the pure half of useLayoutFlip.
 *
 * Given where keyed items were and where they are now, decides which
 * ones should glide from their old place and which are new. Kept
 * DOM-free so the rules (what moves, what's skipped) are unit-tested.
 */

export type FlipRect = { left: number; top: number; width: number; height: number };
export type FlipViewport = { width: number; height: number };

export type FlipPlan = {
  /** Items that changed position: animate from (dx, dy) back to 0. */
  moves: { key: string; dx: number; dy: number }[];
  /** Items that weren't there before (never on the first measurement). */
  entered: string[];
};

export type FlipOptions = {
  /** Movement smaller than this (px) isn't worth animating. */
  minDistance?: number;
  /** More moving items than this: skip the animation entirely — a large
   * re-sort reads as noise, and animating it costs frames. */
  maxMoves?: number;
  /** An item arriving from off screen starts from just outside the
   * viewport edge it comes from, rather than from wherever it was — so a
   * card that was three screens down slides in, instead of streaking the
   * whole distance in one go. Off by default. */
  clampToViewport?: boolean;
  /** Only animate when the items themselves changed — one added, removed
   * or reordered. The same items in the same order just shifting (a row
   * growing because late data filled a card in) then lands at once
   * instead of gliding. Off by default. */
  onlyWhenKeysChange?: boolean;
};

const DEFAULTS = { minDistance: 2, maxMoves: 40, clampToViewport: false, onlyWhenKeysChange: false };

function onScreen(r: FlipRect, v: FlipViewport): boolean {
  return r.left < v.width && r.left + r.width > 0 && r.top < v.height && r.top + r.height > 0;
}

/** Same keys, same order (maps iterate in insertion order). */
function sameKeys(a: ReadonlyMap<string, unknown>, b: ReadonlyMap<string, unknown>): boolean {
  if (a.size !== b.size) return false;
  const other = b.keys();
  for (const key of a.keys()) if (key !== other.next().value) return false;
  return true;
}

/** `r` pulled in to sit just outside the viewport edge(s) it lies beyond. */
function nearestOffScreen(r: FlipRect, v: FlipViewport): FlipRect {
  return {
    ...r,
    left: Math.min(Math.max(r.left, -r.width), v.width),
    top: Math.min(Math.max(r.top, -r.height), v.height),
  };
}

/**
 * `prev` null means "first measurement": nothing moves and nothing
 * counts as entered, so a list never animates on initial load.
 * An item only moves if its old OR new place is on screen; rects are
 * viewport-relative, so callers must first correct `prev` for any
 * scrolling since it was measured (see `shiftRects`).
 */
export function planFlip(
  prev: ReadonlyMap<string, FlipRect> | null,
  next: ReadonlyMap<string, FlipRect>,
  viewport: FlipViewport,
  options: FlipOptions = {},
): FlipPlan {
  const { minDistance, maxMoves, clampToViewport, onlyWhenKeysChange } = { ...DEFAULTS, ...options };
  const plan: FlipPlan = { moves: [], entered: [] };
  if (!prev) return plan;
  if (onlyWhenKeysChange && sameKeys(prev, next)) return plan;
  for (const [key, now] of next) {
    const was = prev.get(key);
    if (!was) {
      if (onScreen(now, viewport)) plan.entered.push(key);
      continue;
    }
    if (Math.hypot(was.left - now.left, was.top - now.top) < minDistance) continue;
    const wasOnScreen = onScreen(was, viewport);
    if (!onScreen(now, viewport) && !wasOnScreen) continue;
    const before = clampToViewport && !wasOnScreen ? nearestOffScreen(was, viewport) : was;
    const dx = before.left - now.left;
    const dy = before.top - now.top;
    plan.moves.push({ key, dx, dy });
  }
  if (plan.moves.length > maxMoves) plan.moves = [];
  return plan;
}

/** Rects moved by (dx, dy) — used to cancel out page scrolling between
 * two measurements, so scrolling alone never looks like a layout change. */
export function shiftRects(rects: ReadonlyMap<string, FlipRect>, dx: number, dy: number): Map<string, FlipRect> {
  const out = new Map<string, FlipRect>();
  for (const [key, r] of rects) out.set(key, { ...r, left: r.left + dx, top: r.top + dy });
  return out;
}

/**
 * The (x, y) a computed `transform` moves an element by, when it is a
 * plain translation ("none" counts as no movement). `null` for anything
 * else (scale, rotation, 3D) — the caller can't then subtract it from a
 * measured box to recover the element's real layout position.
 */
export function translationOf(transform: string): { x: number; y: number } | null {
  if (!transform || transform === "none") return { x: 0, y: 0 };
  const match = /^matrix\(([^)]+)\)$/.exec(transform.trim());
  if (!match) return null;
  const [a, b, c, d, x, y] = match[1].split(",").map(Number);
  if (![a, b, c, d, x, y].every(Number.isFinite)) return null;
  const near = (value: number, target: number) => Math.abs(value - target) < 1e-4;
  return near(a, 1) && near(b, 0) && near(c, 0) && near(d, 1) ? { x, y } : null;
}

/** Whether two boxes are in the same place, give or take sub-pixel
 * rounding — i.e. an item mid-animation is still heading where it was. */
export function sameSpot(a: FlipRect, b: FlipRect, tolerance = 1): boolean {
  return Math.abs(a.left - b.left) < tolerance && Math.abs(a.top - b.top) < tolerance;
}
