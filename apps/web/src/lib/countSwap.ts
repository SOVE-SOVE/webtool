/**
 * Pure state behind `components/ui/AnimatedCount.tsx` — which value is
 * showing, which one (if any) is on its way out, and how many swaps have
 * played — kept DOM-free so the rules are unit-tested:
 *
 * - the first value ever shown (including a `null` placeholder → first
 *   real value) never animates: there is no fictional "from" — and nor
 *   does anything while the caller passes `animate: false`;
 * - a change swaps straight from the value on screen to the latest one —
 *   never a tally through the numbers in between;
 * - a change arriving mid-swap replaces the outgoing value rather than
 *   queueing behind it, so rapid updates settle on the latest.
 */
export type CountSwapState = {
  /** The value to show (and the only one assistive tech reads). */
  current: string | null;
  /** The value fading out, or null when nothing is. */
  outgoing: string | null;
  /** Swaps played so far; 0 means nothing has animated yet. */
  swaps: number;
};

export function countText(value: number | string | null | undefined): string | null {
  return value === null || value === undefined ? null : String(value);
}

export function initialCountSwap(value: string | null): CountSwapState {
  return { current: value, outgoing: null, swaps: 0 };
}

export function nextCountSwap(state: CountSwapState, value: string | null, animate = true): CountSwapState {
  if (value === state.current) return state;
  // Nothing was showing (still loading), or nothing will be: no swap to
  // play. Nor while the caller says the number is still settling (a page
  // whose count is built from several requests that land one by one).
  if (!animate || state.current === null || value === null) return { ...state, current: value, outgoing: null };
  return { current: value, outgoing: state.current, swaps: state.swaps + 1 };
}

/** The outgoing value's exit finished. `swaps` is the swap it belonged
 * to, so a late event from a superseded exit clears nothing. */
export function settleCountSwap(state: CountSwapState, swaps: number): CountSwapState {
  return state.outgoing === null || state.swaps !== swaps ? state : { ...state, outgoing: null };
}
