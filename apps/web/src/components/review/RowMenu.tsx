"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export type RowMenuItem =
  | { kind: "link"; label: string; href: string }
  | { kind: "action"; label: string; onSelect: () => void; danger?: boolean; disabled?: boolean };

/**
 * A small "more actions" menu for a list row. Deliberately minimal:
 * opens on click, closes on Escape / outside click / selection, returns
 * focus to its trigger, and supports Arrow-key movement. Rendered
 * absolutely (no portal) so list containers must not clip overflow.
 */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    // Move focus into the menu so arrow keys work straight away.
    wrapRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const els = Array.from(wrapRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
    const i = els.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (i + 1) % els.length : (i - 1 + els.length) % els.length;
    els[next]?.focus();
  }

  const itemClass =
    "block w-full px-3 py-2 text-left text-sm hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none disabled:opacity-50";

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="btn btn-ghost h-8 w-8 !p-0"
      >
        <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
          <circle cx="3" cy="8" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="13" cy="8" r="1.4" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-30 mt-1 w-48 overflow-hidden rounded-md border border-border-strong bg-surface py-1 shadow-lg"
        >
          {items.map((item) =>
            item.kind === "link" ? (
              <Link key={item.label} role="menuitem" href={item.href} className={`${itemClass} text-fg`} onClick={() => setOpen(false)}>
                {item.label}
              </Link>
            ) : (
              <button
                key={item.label}
                role="menuitem"
                type="button"
                disabled={item.disabled}
                className={`${itemClass} ${item.danger ? "text-red-700 dark:text-red-400" : "text-fg"}`}
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
