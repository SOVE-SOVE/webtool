"use client";

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
  return (
    <div role="tablist" className={`flex gap-4 overflow-x-auto border-b border-border ${className}`}>
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={`shrink-0 border-b-2 py-2.5 text-sm font-medium transition-colors ${
              isActive ? "border-fg text-fg" : "border-transparent text-fg-muted hover:text-fg"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
