"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Checkbox } from "./Checkbox";
import { FiltersIcon } from "./ControlIcons";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

/**
 * The "Filters" trigger of a CommandBar and the popover it opens, which
 * holds the secondary criteria so they don't permanently occupy the page.
 *
 * `activeCount` is how many filters *inside* the popover are set — shown
 * as a count on the trigger, and it decides whether "Clear all" appears.
 * (Search and Sort live outside the popover and aren't counted.)
 *
 * A non-modal popover, so the rest of the page stays usable:
 * - Opening moves focus to the first control inside; Escape closes it and
 *   puts focus back on the trigger.
 * - A pointer press outside, or Tab moving focus out of it, closes it.
 * - `aria-haspopup`/`aria-expanded`/`aria-controls` on the trigger and
 *   `role="dialog"` on the panel expose it to assistive tech.
 */
export function FilterPopover({
  activeCount,
  onClearAll,
  label = "Filters",
  align = "start",
  children,
}: {
  activeCount: number;
  onClearAll?: () => void;
  label?: string;
  /** Which edge of the trigger the panel lines up with. */
  align?: "start" | "end";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panelRef.current)?.focus({ preventScroll: true });
    // On a phone the panel can open below the fold, behind the bottom nav
    // (`scroll-mb-24` on the panel leaves room for it).
    panelRef.current?.scrollIntoView({ block: "nearest" });

    function handlePointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  return (
    <div
      ref={rootRef}
      className="relative"
      onKeyDown={handleKeyDown}
      onBlur={(e) => {
        // Only a real move of focus to somewhere outside closes it: a
        // click on a non-focusable part of the panel blurs with no
        // relatedTarget, and the pointerdown handler covers true outside clicks.
        if (open && e.relatedTarget instanceof Node && !rootRef.current?.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className="control-btn"
      >
        <FiltersIcon className="h-4 w-4 text-fg-muted" />
        {label}
        {activeCount > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-fg">
            {activeCount}
            <span className="sr-only"> active</span>
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label={label}
          tabIndex={-1}
          className={`animate-rise-in absolute top-full z-30 mt-2 scroll-mb-24 w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface p-4 shadow-xl outline-none ${
            align === "end" ? "right-0" : "left-0"
          }`}
        >
          <div className="max-h-[min(60vh,28rem)] space-y-3 overflow-y-auto pr-0.5">{children}</div>
          <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3">
            {activeCount > 0 && onClearAll ? (
              <button type="button" onClick={onClearAll} className="btn btn-ghost btn-sm">
                Clear all
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
              className="btn btn-secondary btn-sm"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One labelled field inside a FilterPopover. The <label> wraps its
 * control, so the label text names it with no id plumbing.
 */
export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

/** An on/off criterion inside a FilterPopover (e.g. "Show archived"). */
export function FilterToggle({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label
      className={`flex items-start gap-2.5 rounded-lg px-2 py-1.5 text-sm ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer transition-colors duration-fast ease-standard hover:bg-surface-hover"
      }`}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <span className="min-w-0">
        <span className="block text-fg">{label}</span>
        {hint && <span className="block text-xs text-fg-muted">{hint}</span>}
      </span>
    </label>
  );
}
