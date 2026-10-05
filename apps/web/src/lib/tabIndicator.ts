/**
 * Active-tab underline geometry — the pure half of `TabBar`
 * (components/ui/Tabs.tsx). Decides when the underline should travel
 * and when it should simply be where the tab is. DOM-free, so the rules
 * are unit-tested.
 */

export type IndicatorRect = { left: number; width: number };

export type IndicatorState = IndicatorRect & {
  /** The tab this rect was measured for. */
  tabId: string;
  /** Whether this change should be animated (a tab switch) or applied
   * at once (first paint, or the same tab re-measured). */
  animate: boolean;
};

/** Where a tab group's underline last was, kept across a remount. */
export type IndicatorMemory = { tabId: string; rect: IndicatorRect; at: number };

/** A remembered position older than this belongs to an earlier visit,
 * not to the navigation that just happened. */
export const TRAVEL_MAX_AGE_MS = 1000;

export function sameRect(a: IndicatorRect, b: IndicatorRect): boolean {
  return a.left === b.left && a.width === b.width;
}

/**
 * The underline's next state after measuring the active tab.
 *
 * - Nothing measured yet: appear in place (never slide in from the edge).
 * - A different tab became active: travel to it.
 * - The same tab, but its box changed (a count badge loaded, a font
 *   swapped in, the strip resized): follow at once — the label itself
 *   didn't animate, so a trailing underline would only lag behind it.
 * - Nothing changed: the previous state, by identity, so callers can
 *   skip the update.
 */
export function nextIndicator(prev: IndicatorState | null, rect: IndicatorRect, active: string): IndicatorState {
  if (!prev) return { ...rect, tabId: active, animate: false };
  if (prev.tabId !== active) return { ...rect, tabId: active, animate: true };
  if (sameRect(prev, rect)) return prev;
  return { ...rect, tabId: active, animate: false };
}

/**
 * Where a freshly mounted bar's underline should travel *from*: the
 * spot the same tab group's previous instance left it, when that
 * instance went away just now with a different tab active (route-per-tab
 * bars remount on every switch). `null` means "appear in place".
 */
export function travelOrigin(
  memory: IndicatorMemory | undefined,
  active: string,
  now: number,
  maxAge: number = TRAVEL_MAX_AGE_MS,
): IndicatorRect | null {
  if (!memory || memory.tabId === active) return null;
  if (now - memory.at > maxAge || now < memory.at) return null;
  if (memory.rect.width <= 0) return null; // measured while hidden
  return memory.rect;
}
