"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";

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
}) {
  const ws = variant === "workspace";
  const tabRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    function measure() {
      const el = tabRefs.current.get(active);
      if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, tabs.map((t) => t.label).join("|")]);

  return (
    <div
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
            {tab.count !== undefined && <span className="ml-1.5 text-xs text-fg-subtle">{tab.count}</span>}
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
        <span
          aria-hidden="true"
          className={`absolute bottom-0 bg-fg transition-[left,width] duration-[var(--duration-base)] ease-standard motion-reduce:transition-none ${ws ? "h-px" : "h-0.5"}`}
          style={{ left: indicator.left, width: indicator.width }}
        />
      )}
    </div>
  );
}
