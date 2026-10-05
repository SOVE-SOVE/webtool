"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import { AnimatedCount } from "./AnimatedCount";
import { nextIndicator, sameRect, travelOrigin, type IndicatorMemory, type IndicatorRect, type IndicatorState } from "@/lib/tabIndicator";

/** Where each `travelKey` group's underline last was — survives the
 * bar itself being remounted by a route change. */
const indicatorMemory = new Map<string, IndicatorMemory>();
const TRAVEL_MS = 200; // --duration-base
const TRAVEL_EASE = "cubic-bezier(0.4, 0, 0.2, 1)"; // --ease-standard

export type TabItem = {
  id: string;
  label: string;
  count?: number;
  /**
   * When set, this tab renders as a real `<Link>` to this URL instead of
   * a button firing `onChange` — for workspaces like Build/Sales where
   * each tab is its own route (so browser Back/Forward, direct links,
   * and open-in-new-tab all keep working), as opposed to Clients' single
   * route + `?tab=` query param switched via local state.
   */
  href?: string;
};

/**
 * A horizontal tab strip — underline style, keyboard/scroll friendly on
 * narrow screens. Deliberately not a `<Disclosure>`-style accordion:
 * tabs are for switching between whole sections of a page, not
 * progressively revealing detail within one.
 *
 * Two modes, per tab: a plain `id` fires `onChange` (Clients' own
 * usage — one route, local/URL-param state); an `href` renders a real
 * `<Link>` instead (Build/Sales — distinct routes per tab). Both modes
 * share the exact same visual markup/classes, so the active-tab
 * underline, hover/focus states, and responsive overflow behave
 * identically regardless of which a given workspace uses.
 */
export function TabBar({
  tabs,
  active,
  onChange,
  className = "",
  ariaLabel,
  variant = "default",
  travelKey,
}: {
  tabs: readonly TabItem[];
  active: string;
  onChange?: (id: string) => void;
  className?: string;
  ariaLabel?: string;
  /**
   * `workspace` is the refined strip for the four top-level workspace
   * headers (Today, Sales, Build, Clients): a fixed 36px row, first
   * label flush with the page content, a 1px active line on the
   * baseline, and an inset keyboard ring. The strip's -mx-1 offsets the
   * tabs' px-1 so the first label lines up with the content below. Opt-in only — every other
   * TabBar (detail pages, Settings, Discovery) keeps `default`.
   */
  variant?: "default" | "workspace";
  /**
   * Only for route-per-tab bars that each page renders for itself
   * (Build): the bar is remounted on every switch, so its underline
   * would just appear under the new tab. Bars sharing a `travelKey`
   * remember where the underline was, and the next instance travels
   * from there. Not needed when the bar lives in a shared layout
   * (Sales, Discovery) or switches in place (`onChange`) — it already
   * persists.
   */
  travelKey?: string;
}) {
  const ws = variant === "workspace";
  const listRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Map<string, HTMLElement>>(new Map());
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const [indicator, setIndicator] = useState<IndicatorState | null>(null);
  // `undefined` until looked up once on mount; a rect while a remounted
  // bar still owes its underline the trip from the previous instance.
  const originRef = useRef<IndicatorRect | null | undefined>(undefined);
  // Everything that sets a tab's width, so a commit that changes one
  // re-measures before paint instead of a frame later via the observer.
  const tabsKey = tabs.map((t) => `${t.id}:${t.label}:${t.count ?? ""}`).join("|");

  // Measures the active tab on every switch, and again whenever a tab's
  // box or the strip changes with no switch at all — a count badge
  // loading, a web font swapping in, the strip being un-hidden or
  // resized — which a window `resize` listener alone never saw.
  useLayoutEffect(() => {
    if (originRef.current === undefined) {
      originRef.current = travelKey ? travelOrigin(indicatorMemory.get(travelKey), active, performance.now()) : null;
    }
    function measure() {
      const el = tabRefs.current.get(active);
      if (!el) return;
      const rect = { left: el.offsetLeft, width: el.offsetWidth };
      setIndicator((prev) => nextIndicator(prev, rect, active));
      if (travelKey) indicatorMemory.set(travelKey, { tabId: active, rect, at: performance.now() });
    }
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    if (listRef.current) observer.observe(listRef.current);
    for (const el of tabRefs.current.values()) observer.observe(el);
    return () => {
      observer.disconnect();
      // Stamp when this instance was last on screen, so only the bar
      // that replaces it straight away picks the position up.
      const memory = travelKey ? indicatorMemory.get(travelKey) : undefined;
      if (travelKey && memory) indicatorMemory.set(travelKey, { ...memory, at: performance.now() });
    };
  }, [active, tabsKey, travelKey]);

  // A remounted bar's first underline is already in its final place (so
  // nothing is ever left mispositioned); this plays the trip there from
  // where the previous instance had it. Web Animations API, so it needs
  // no staged render and can't collide with the CSS transition below.
  useLayoutEffect(() => {
    const origin = originRef.current;
    const el = indicatorRef.current;
    if (!origin || !indicator || !el) return;
    originRef.current = null;
    if (sameRect(origin, indicator)) return;
    if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.animate(
      [
        { left: `${origin.left}px`, width: `${origin.width}px` },
        { left: `${indicator.left}px`, width: `${indicator.width}px` },
      ],
      { duration: TRAVEL_MS, easing: TRAVEL_EASE },
    );
  }, [indicator]);

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      className={`relative flex overflow-x-auto ${
        ws
          ? "-mx-1 gap-4 shadow-[inset_0_-1px_0_var(--color-border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          : "gap-4 border-b border-border"
      } ${className}`}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        const tabClassName = ws
          ? `shrink-0 whitespace-nowrap rounded-sm px-1 py-2 text-sm font-medium leading-5 transition-colors duration-fast ease-standard motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring ${
              isActive ? "text-fg" : "text-fg-muted hover:text-fg"
            }`
          : `shrink-0 border-b-2 border-transparent py-2.5 text-sm font-medium transition-colors duration-fast ease-standard motion-reduce:transition-none ${
              isActive ? "text-fg" : "text-fg-muted hover:border-border-strong hover:text-fg"
            }`;
        const setRef = (el: HTMLElement | null) => {
          if (el) tabRefs.current.set(tab.id, el);
          else tabRefs.current.delete(tab.id);
        };
        const label = (
          <>
            {tab.label}
            {tab.count !== undefined && (
              <span className="ml-1.5 text-xs text-fg-subtle">
                <AnimatedCount value={tab.count} />
              </span>
            )}
          </>
        );
        return tab.href ? (
          <Link key={tab.id} ref={setRef} href={tab.href} role="tab" aria-selected={isActive} className={tabClassName}>
            {label}
          </Link>
        ) : (
          <button
            key={tab.id}
            ref={setRef}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange?.(tab.id)}
            className={tabClassName}
          >
            {label}
          </button>
        );
      })}
      {indicator && (
        // Kept on left/width rather than translateX/scaleX: a scaled
        // 1–2px line is composited separately while it moves and isn't
        // guaranteed to land on the same pixel row as at rest. This is
        // one out-of-flow element, so the layout it costs is trivial.
        <span
          ref={indicatorRef}
          aria-hidden="true"
          className={`absolute bottom-0 bg-fg ${
            indicator.animate ? "transition-[left,width] duration-[var(--duration-base)] ease-standard motion-reduce:transition-none" : ""
          } ${ws ? "h-px" : "h-0.5"}`}
          style={{ left: indicator.left, width: indicator.width }}
        />
      )}
    </div>
  );
}
