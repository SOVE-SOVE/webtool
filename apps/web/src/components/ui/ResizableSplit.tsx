"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

const HANDLE_WIDTH = 6; // px

/**
 * Draggable-divider two-column layout for Planning's findings+evidence
 * panels. Below `lg` (matching every other `lg:`-gated breakpoint in
 * this app), renders the existing, unmodified stacked/320px-fixed grid
 * verbatim — mobile/tablet keep exactly today's behaviour, and that
 * markup path IS the "collapse to the existing stacked layout when
 * space is insufficient" requirement. At `lg`+, becomes a resizable
 * flex row with a keyboard- and pointer-draggable divider, remembering
 * the chosen ratio in localStorage.
 */
export function ResizableSplit({
  primary,
  secondary,
  storageKey,
  defaultRatio = 0.75,
  minPrimaryPx = 360,
  minSecondaryPx = 240,
}: {
  primary: ReactNode;
  secondary: ReactNode;
  storageKey: string;
  defaultRatio?: number;
  minPrimaryPx?: number;
  minSecondaryPx?: number;
}) {
  const [isDesktop, setIsDesktop] = useState(false);
  const [ratio, setRatio] = useState(defaultRatio);
  const [containerWidth, setContainerWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsDesktop(mq.matches);
    const onChange = () => setIsDesktop(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const parsed = parseFloat(saved);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (!Number.isNaN(parsed)) setRatio(parsed);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!isDesktop || !containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver((entries) => setContainerWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [isDesktop]);

  function clampRatio(raw: number, width: number): number {
    if (!width) return Math.min(Math.max(raw, 0), 1);
    const minRatio = minPrimaryPx / width;
    const maxRatio = 1 - minSecondaryPx / width;
    return Math.min(Math.max(raw, minRatio), maxRatio);
  }

  function persist(next: number) {
    setRatio(next);
    localStorage.setItem(storageKey, String(next));
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    persist(clampRatio((e.clientX - rect.left) / rect.width, rect.width));
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const width = containerRef.current?.getBoundingClientRect().width ?? containerWidth;
    const step = 0.03;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      persist(clampRatio(ratio - step, width));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      persist(clampRatio(ratio + step, width));
    } else if (e.key === "Home") {
      e.preventDefault();
      persist(clampRatio(0, width));
    } else if (e.key === "End") {
      e.preventDefault();
      persist(clampRatio(1, width));
    }
  }

  if (!isDesktop) {
    return (
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6">
        {primary}
        {secondary}
      </div>
    );
  }

  const pct = Math.round(ratio * 100);
  const minPct = containerWidth ? Math.round((minPrimaryPx / containerWidth) * 100) : 0;
  const maxPct = containerWidth ? 100 - Math.round((minSecondaryPx / containerWidth) * 100) : 100;

  return (
    <div ref={containerRef} className="flex items-start">
      <div style={{ width: `calc(${pct}% - ${HANDLE_WIDTH / 2}px)` }} className="min-w-0">
        {primary}
      </div>
      {/* Wide (6px) hit area for an easy pointer/touch target. A resize
          handle that's invisible until hovered is easy to miss
          entirely, so this stays visible at rest: a full-height seam
          (matching the app's existing hairline-border colour, so it
          still reads as part of the layout) plus a small vertical grip
          — three dots, the conventional "draggable" affordance used
          throughout desktop software — centered on it. Both
          strengthen further on hover/focus. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize findings and evidence panels"
        aria-valuenow={pct}
        aria-valuemin={minPct}
        aria-valuemax={maxPct}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={handleKeyDown}
        className="group relative mx-1 shrink-0 cursor-col-resize self-stretch rounded focus-visible:outline-none"
        style={{ width: HANDLE_WIDTH }}
      >
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 rounded-full bg-border-strong transition-colors duration-[var(--duration-fast)] group-hover:bg-fg-subtle group-focus-visible:bg-fg-subtle"
        />
        {/* The grip is `sticky`, not centered on the whole (potentially
            very long) findings column — centering on full height would
            often place it below the fold, out of view without
            scrolling. Sticky keeps it in view as the page scrolls,
            like the resize action itself should be. top-44 clears
            Planning's own sticky business-name header (~119px tall,
            offset 44px below the desktop top bar) so the grip isn't
            painted over by it. */}
        <div className="sticky top-44 flex justify-center">
          <span aria-hidden="true" className="flex flex-col gap-1 rounded-full bg-surface py-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-1 w-1 rounded-full bg-border-strong transition-colors duration-[var(--duration-fast)] group-hover:bg-fg-subtle group-focus-visible:bg-fg-subtle"
              />
            ))}
          </span>
        </div>
      </div>
      <div style={{ width: `calc(${100 - pct}% - ${HANDLE_WIDTH / 2}px)` }} className="min-w-0">
        {secondary}
      </div>
    </div>
  );
}
