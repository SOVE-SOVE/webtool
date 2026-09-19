"use client";

import { useState, type ReactNode } from "react";

/**
 * A results container that eases (a short opacity settle — no movement,
 * so nothing shifts) when the *query* behind it changes: a filter, sort
 * or tab switch — instead of the list snapping to its new contents.
 *
 * `signature` should encode only the user's choices (tab, filters, sort,
 * view), never the data itself and never live search text — so a poll
 * refresh doesn't pulse, and typing in a search box stays immediate.
 * Nothing plays on first mount.
 *
 * The animation is restarted by alternating between two identical
 * keyframe names, so children are never remounted (focus, scroll and
 * row state survive). `className` lands on the wrapper, so it can *be*
 * the grid/list container rather than adding a layout layer.
 */
export function SoftSwap({
  signature,
  className = "",
  children,
}: {
  signature: string;
  className?: string;
  children: ReactNode;
}) {
  const [prev, setPrev] = useState(signature);
  const [swaps, setSwaps] = useState(0);
  if (signature !== prev) {
    setPrev(signature);
    setSwaps(swaps + 1);
  }
  const motion = swaps === 0 ? "" : swaps % 2 === 1 ? "soft-swap-a" : "soft-swap-b";
  return <div className={`${className} ${motion}`.trim()}>{children}</div>;
}
