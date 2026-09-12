"use client";

import { useState } from "react";
import type { Planning } from "@/lib/api";

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
}: {
  planning: Planning;
  evidence?: { label: string; text: string } | null;
}) {
  const hasDesktop = Boolean(planning.screenshot_desktop_base64);
  const hasMobile = Boolean(planning.screenshot_mobile_base64);
  const [view, setView] = useState<"desktop" | "mobile">(hasDesktop ? "desktop" : "mobile");

  if (!hasDesktop && !hasMobile) {
    return (
      <div className="rounded-md border border-border bg-surface-subtle px-4 py-10 text-center">
        <p className="text-sm text-fg-muted">No screenshot captured yet.</p>
      </div>
    );
  }

  const src = view === "desktop" ? planning.screenshot_desktop_base64 : planning.screenshot_mobile_base64;

  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p className="text-xs font-medium text-fg-subtle">Website preview</p>
        {hasDesktop && hasMobile && (
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setView("desktop")}
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                view === "desktop" ? "bg-surface-subtle text-fg" : "text-fg-muted hover:text-fg"
              }`}
            >
              Desktop
            </button>
            <button
              type="button"
              onClick={() => setView("mobile")}
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                view === "mobile" ? "bg-surface-subtle text-fg" : "text-fg-muted hover:text-fg"
              }`}
            >
              Mobile
            </button>
          </div>
        )}
      </div>
      <div className="max-h-[420px] overflow-auto p-3">
        {src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`data:image/png;base64,${src}`}
            alt={`${view === "desktop" ? "Desktop" : "Mobile"} screenshot of the business's website`}
            className={
              view === "mobile"
                ? "mx-auto max-w-[240px] rounded border border-border"
                : "w-full rounded border border-border"
            }
          />
        )}
      </div>
      {evidence && (
        <div className="border-t border-border bg-surface-subtle px-3 py-2.5">
          <p className="text-xs font-medium text-fg-subtle">{evidence.label}</p>
          <p className="mt-0.5 text-sm text-fg">{evidence.text}</p>
        </div>
      )}
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
