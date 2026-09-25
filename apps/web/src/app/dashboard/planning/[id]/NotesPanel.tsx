"use client";

import { useRef } from "react";
import type { Planning } from "@/lib/api";
import { useDismissableOverlay } from "@/lib/useDismissableOverlay";
import { NotesTab } from "./NotesTab";

/**
 * Operator Notes as a slide-over, reachable from every step via
 * ProcessNav's one persistent control instead of being a sixth,
 * equal-weight step. Same data, same editor as before (`NotesTab`
 * unchanged) — this only changes where it's opened from.
 */
export function NotesPanel({
  planning,
  onUpdated,
  onClose,
}: {
  planning: Planning;
  onUpdated: (p: Planning) => void;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { containerRef } = useDismissableOverlay({ open: true, onClose, initialFocusRef: closeButtonRef });

  return (
    <div className="side-panel-overlay" onClick={onClose} role="presentation">
      <div
        ref={containerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Operator notes"
        className="side-panel side-panel--wide focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border p-4">
          <h2 className="text-base font-semibold text-fg">Notes</h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close notes"
            className="shrink-0 rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path d="M4.22 4.22a.75.75 0 0 1 1.06 0L10 8.94l4.72-4.72a.75.75 0 1 1 1.06 1.06L11.06 10l4.72 4.72a.75.75 0 1 1-1.06 1.06L10 11.06l-4.72 4.72a.75.75 0 0 1-1.06-1.06L8.94 10 4.22 5.28a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <NotesTab planning={planning} onUpdated={onUpdated} />
        </div>
      </div>
    </div>
  );
}
