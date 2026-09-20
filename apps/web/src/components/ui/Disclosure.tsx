"use client";

import { useState, type ReactNode } from "react";
import { AnimatedHeight } from "./AnimatedHeight";

/**
 * A collapsible section. Children are only mounted while open, so a page
 * can stack several heavy editors without rendering (or fetching for)
 * all of them at once.
 */
export function Disclosure({
  title,
  hint,
  badge,
  defaultOpen = false,
  children,
}: {
  title: ReactNode;
  hint?: ReactNode;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors duration-fast ease-standard hover:bg-surface-hover motion-reduce:transition-none"
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-sm font-medium text-fg">
            <span
              aria-hidden="true"
              className={`inline-block text-fg-subtle transition-transform duration-[var(--duration-fast)] ease-standard motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
            >
              ▸
            </span>
            {title}
          </span>
          {hint && <span className="mt-0.5 block truncate pl-4 text-xs text-fg-muted">{hint}</span>}
        </span>
        {badge && <span className="shrink-0">{badge}</span>}
      </button>
      <AnimatedHeight open={open}>
        <div className="border-t border-border p-4">{children}</div>
      </AnimatedHeight>
    </div>
  );
}
