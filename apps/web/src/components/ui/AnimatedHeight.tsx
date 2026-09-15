"use client";

import { useState, type ReactNode } from "react";

/**
 * Animates a container between zero height and its content's natural
 * height (a CSS grid-rows trick — no JS measurement needed). Children
 * stay mounted while open, and for one extra transition after closing
 * (so the closing animation has something to shrink), then unmount —
 * preserving callers' existing "don't render heavy content while
 * collapsed" behaviour rather than keeping it mounted forever.
 */
export function AnimatedHeight({ open, children }: { open: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  // Tracks `open` from the previous render so a transition can be
  // reacted to during render itself (React's documented way to adjust
  // state in response to a changed prop) instead of in an effect.
  const [prevOpen, setPrevOpen] = useState(open);

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setMounted(true);
    } else if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Reduced motion disables the transition, so it never fires
      // `transitionend` — unmount immediately instead of waiting on an
      // event that won't come.
      setMounted(false);
    }
  }

  return (
    <div
      className="grid transition-[grid-template-rows] duration-[var(--duration-base)] ease-standard motion-reduce:transition-none"
      style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      onTransitionEnd={(e) => {
        if (e.propertyName === "grid-template-rows" && !open) setMounted(false);
      }}
      aria-hidden={!open}
    >
      <div className="overflow-hidden">{mounted && children}</div>
    </div>
  );
}
