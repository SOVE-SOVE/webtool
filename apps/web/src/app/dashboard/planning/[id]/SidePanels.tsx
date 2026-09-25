"use client";

import { useEffect, useRef, useState } from "react";
import type { Planning } from "@/lib/api";
import { useDismissableOverlay } from "@/lib/useDismissableOverlay";

type PreviewView = "desktop" | "mobile";

function ViewToggle({
  view,
  onChange,
}: {
  view: PreviewView;
  onChange: (next: PreviewView) => void;
}) {
  return (
    <div className="flex gap-1">
      {(["desktop", "mobile"] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={view === v}
          className={`rounded px-2 py-0.5 text-xs font-medium transition-colors duration-[var(--duration-fast)] ${
            view === v ? "bg-surface-subtle text-fg" : "text-fg-muted hover:text-fg"
          }`}
        >
          {v === "desktop" ? "Desktop" : "Mobile"}
        </button>
      ))}
    </div>
  );
}

/**
 * Large view of the same screenshot — the in-page preview is sized to
 * sit beside the findings, so this is the "inspect the details" escape
 * hatch. Desktop shots fill the dialog width and scroll vertically;
 * mobile shots stay phone-shaped so they aren't stretched.
 */
function ScreenshotDialog({
  src,
  view,
  canSwitch,
  onChangeView,
  onClose,
}: {
  src: string;
  view: PreviewView;
  canSwitch: boolean;
  onChangeView: (next: PreviewView) => void;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // Escape-to-close, Tab focus trap, and focus restored to the Expand
  // button on close — the app's shared overlay behaviour.
  const { containerRef } = useDismissableOverlay({ open: true, onClose, initialFocusRef: closeButtonRef });
  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        ref={containerRef}
        tabIndex={-1}
        className="modal-panel flex max-h-[calc(100dvh-2rem)] w-[min(96vw,1400px)] max-w-none flex-col p-0 focus:outline-none"
        role="dialog"
        aria-modal="true"
        aria-label="Website screenshot, expanded"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <p className="text-sm font-medium text-fg">Website preview</p>
          <div className="flex items-center gap-3">
            {canSwitch && <ViewToggle view={view} onChange={onChangeView} />}
            <button ref={closeButtonRef} type="button" onClick={onClose} className="btn btn-secondary btn-sm">
              Close
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:image/png;base64,${src}`}
            alt={`${view === "desktop" ? "Desktop" : "Mobile"} screenshot of the business's website`}
            className={
              view === "desktop"
                ? "w-full rounded border border-border"
                : "mx-auto max-w-[420px] rounded border border-border"
            }
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Website preview + evidence panel — the desktop-beside-findings panel
 * from the Overview tab, also reused (screenshots only) on the
 * Website Audit tab. Selecting a Top Opportunity or a compact status
 * row sets `evidence`, which this renders directly under the preview
 * rather than trying to highlight a region of the screenshot itself
 * (no coordinate data exists to do that accurately).
 */
export function EvidencePanel({
  planning,
  evidence,
  emptyStateMessage = "No screenshot captured yet.",
}: {
  planning: Planning;
  evidence?: { label: string; text: string } | null;
  /** Overrides the default "no screenshot" copy when there's a more
   * specific, data-backed reason to give (e.g. an audit ran but the
   * capture itself failed) — never a fabricated cause. */
  emptyStateMessage?: string;
}) {
  const hasDesktop = Boolean(planning.screenshot_desktop_base64);
  const hasMobile = Boolean(planning.screenshot_mobile_base64);
  const [view, setView] = useState<PreviewView>(hasDesktop ? "desktop" : "mobile");
  const [expanded, setExpanded] = useState(false);
  // Lags one beat behind `view` so the outgoing screenshot can fade out
  // before the incoming one swaps in and fades in — the two screenshots
  // have different aspect ratios, so crossfading them simultaneously
  // (rather than sequentially) would overlap mismatched images.
  const [displayView, setDisplayView] = useState(view);
  const [fading, setFading] = useState(false);
  const fadeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (fadeTimeout.current) clearTimeout(fadeTimeout.current);
  }, []);

  function handleSetView(next: PreviewView) {
    if (next === view) return;
    setView(next);
    const prefersReduced =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) {
      setDisplayView(next);
      return;
    }
    setFading(true);
    if (fadeTimeout.current) clearTimeout(fadeTimeout.current);
    fadeTimeout.current = setTimeout(() => {
      setDisplayView(next);
      setFading(false);
    }, 100);
  }

  if (!hasDesktop && !hasMobile) {
    return (
      <div className="rounded-md border border-border bg-surface-subtle px-4 py-10 text-center">
        <p className="text-sm text-fg-muted">{emptyStateMessage}</p>
      </div>
    );
  }

  const src = displayView === "desktop" ? planning.screenshot_desktop_base64 : planning.screenshot_mobile_base64;

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p className="text-xs font-medium text-fg-subtle">Website preview</p>
        <div className="flex items-center gap-3">
          {hasDesktop && hasMobile && <ViewToggle view={view} onChange={handleSetView} />}
          {src && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="text-xs font-medium text-fg-muted hover:text-fg hover:underline"
            >
              Expand preview
            </button>
          )}
        </div>
      </div>
      <div className="max-h-[75vh] overflow-auto p-3">
        {src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`data:image/png;base64,${src}`}
            alt={`${displayView === "desktop" ? "Desktop" : "Mobile"} screenshot of the business's website`}
            className={`transition-opacity duration-[var(--duration-base)] ease-standard motion-reduce:transition-none ${
              fading ? "opacity-0" : "opacity-100"
            } ${displayView === "mobile" ? "mx-auto max-w-[280px] rounded border border-border" : "w-full rounded border border-border"}`}
          />
        )}
      </div>
      {expanded && src && (
        <ScreenshotDialog
          src={src}
          view={displayView}
          canSwitch={hasDesktop && hasMobile}
          onChangeView={handleSetView}
          onClose={() => setExpanded(false)}
        />
      )}
      {evidence && (
        <div className="border-t border-border bg-surface-subtle px-3 py-2.5">
          <p className="text-xs font-medium text-fg-subtle">{evidence.label}</p>
          <p className="mt-0.5 text-sm text-fg">{evidence.text}</p>
        </div>
      )}
    </div>
  );
}

/**
 * Stands in for the website preview while an analysis is running — same
 * bordered box as EvidencePanel (so the layout doesn't jump once the
 * real screenshot lands), with a quiet "inspection" sweep instead of an
 * image. Never shows a stale screenshot from a previous run labelled as
 * current: a fresh one is mid-capture, so there's nothing honest to
 * show yet but the box itself.
 */
export function AnalysingPreviewPanel() {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-border px-3 py-2">
        <p className="text-xs font-medium text-fg-subtle">Website preview</p>
      </div>
      <div
        className="scan-surface flex h-[260px] items-center justify-center bg-surface-subtle"
        role="status"
        aria-label="Capturing a fresh screenshot"
      >
        <p className="text-xs text-fg-subtle">Capturing…</p>
      </div>
    </div>
  );
}

/** Compact, read-mostly notes preview for the desktop Overview side panel. */
export function NotesPreview({ notes, onOpenNotes }: { notes: string | null; onOpenNotes: () => void }) {
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-fg-subtle">Operator notes</p>
        <button type="button" onClick={onOpenNotes} className="text-xs text-fg-muted hover:text-fg hover:underline">
          Edit →
        </button>
      </div>
      <p className="mt-1.5 line-clamp-4 whitespace-pre-wrap text-sm text-fg-muted">
        {notes && notes.trim() ? notes : "No notes yet."}
      </p>
    </div>
  );
}
