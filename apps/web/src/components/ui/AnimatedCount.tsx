"use client";

import { useState } from "react";
import { countText, initialCountSwap, nextCountSwap, settleCountSwap } from "@/lib/countSwap";

/**
 * A non-financial count that eases when it changes in place (a refetch,
 * a poll, the result of an action): the old value lifts out as the new
 * one settles in — a swap, never a tally. See lib/countSwap.ts for the
 * rules (no animation on first render or on placeholder → first value;
 * rapid changes settle on the latest).
 *
 * Never use it for money — amounts must land exactly, at once.
 *
 * The current value is ordinary text; the outgoing one is `aria-hidden`,
 * out of flow and removed when its exit ends, so assistive tech only
 * ever reads the current value and the box is always the new value's
 * width. The swap is restarted by alternating two identical keyframe
 * names (as SoftSwap does), so the value's own node is never remounted.
 * Reduced motion: the global backstop in globals.css makes both
 * animations instant.
 */
export function AnimatedCount({
  value,
  animate = true,
  className = "",
}: {
  value: number | string | null | undefined;
  /** False while the number is still settling — a count derived from
   * several requests that land one by one on first load. The value then
   * simply follows; nothing plays until this is true. */
  animate?: boolean;
  className?: string;
}) {
  const text = countText(value);
  const [state, setState] = useState(() => initialCountSwap(text));
  // `animate` only counts from the render after it turned true: the last
  // request of a first load usually lands in the same render that flips
  // it, and that final fill-in is still not a change to announce.
  const [armed, setArmed] = useState(animate);
  if (text !== state.current) setState(nextCountSwap(state, text, animate && armed));
  if (armed !== animate) setArmed(animate);
  if (state.current === null) return null;
  const { swaps } = state;
  // Only while a swap is in flight: a class left on afterwards would
  // replay whenever a hidden ancestor (a kept-mounted tab) is shown again.
  const motion = state.outgoing === null ? "" : swaps % 2 === 1 ? "count-swap-in-a" : "count-swap-in-b";
  return (
    <span className={`relative inline-block whitespace-nowrap tabular-nums ${className}`.trim()}>
      <span className={`inline-block ${motion}`.trim()}>{state.current}</span>
      {state.outgoing !== null && (
        <span
          key={swaps}
          aria-hidden="true"
          // opacity-0 at rest: if the exit never runs, the old value can't sit on top of the new one.
          className="count-swap-out pointer-events-none absolute left-0 top-0 select-none opacity-0"
          onAnimationEnd={() => setState((s) => settleCountSwap(s, swaps))}
        >
          {state.outgoing}
        </span>
      )}
    </span>
  );
}
