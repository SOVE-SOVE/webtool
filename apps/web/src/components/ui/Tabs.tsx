"use client";

import { useLayoutEffect, useRef, useState } from "react";

export type TabItem = {
  id: string;
  label: string;
};

/**
 * A horizontal tab strip — underline style, keyboard/scroll friendly on
 * narrow screens. Deliberately not a `<Disclosure>`-style accordion:
 * tabs are for switching between whole sections of a page, not
 * progressively revealing detail within one.
 */
export function TabBar({
  tabs,
  active,
  onChange,
  className = "",
}: {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    function measure() {
      const el = buttonRefs.current.get(active);
      if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, tabs.map((t) => t.label).join("|")]);

  return (
    <div role="tablist" className={`relative flex gap-4 overflow-x-auto border-b border-border ${className}`}>
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              if (el) buttonRefs.current.set(tab.id, el);
              else buttonRefs.current.delete(tab.id);
            }}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={`shrink-0 border-b-2 border-transparent py-2.5 text-sm font-medium transition-colors duration-[var(--duration-fast)] ${
              isActive ? "text-fg" : "text-fg-muted hover:text-fg"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
      {indicator && (
        <span
          aria-hidden="true"
          className="absolute bottom-0 h-0.5 bg-fg transition-[left,width] duration-[var(--duration-base)] ease-standard motion-reduce:transition-none"
          style={{ left: indicator.left, width: indicator.width }}
        />
      )}
    </div>
  );
}
