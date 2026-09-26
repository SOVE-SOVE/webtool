"use client";

import { useRef, useState } from "react";
import type { Planning } from "@/lib/api";
import { useDismissableOverlay } from "@/lib/useDismissableOverlay";
import { planningMode } from "../lib";
import { AnalysingPreviewPanel, EvidencePanel } from "./SidePanels";

/**
 * On-demand replacement for `WebsitePreviewPanel` on the "Plan"
 * step specifically: that step gives its persistent 320px preview
 * column to the requirements-board canvas instead (see page.tsx), so the
 * screenshot content it used to show at rest here becomes a trigger +
 * dialog instead. Reuses `EvidencePanel`/`AnalysingPreviewPanel` from
 * SidePanels.tsx exactly as `WebsitePreviewPanel` does — same Desktop/
 * Mobile toggle, "Expand preview" modal, capture-time label, and honest
 * empty/failure states — nothing here fetches or captures a screenshot;
 * `planning` already carries whatever there is to show, and this only
 * decides which existing view applies (the same branching
 * `WebsitePreviewPanel` runs, duplicated rather than shared so this
 * step's on-demand version doesn't reach into that other, unrelated
 * component's file to extract it).
 */
export function CurrentWebsiteDialog({ planning }: { planning: Planning }) {
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { containerRef } = useDismissableOverlay({
    open,
    onClose: () => setOpen(false),
    initialFocusRef: closeButtonRef,
  });

  const mode = planningMode(planning);
  const hasAudit = planning.website_audit_id !== null;
  const isAnalysing = planning.status === "analysing";
  const hasScreenshot = Boolean(planning.screenshot_desktop_base64 || planning.screenshot_mobile_base64);

  let body;
  if (isAnalysing && !hasAudit) {
    body = <AnalysingPreviewPanel />;
  } else if (mode === "new" && !hasAudit) {
    body = (
      <EvidencePanel
        planning={planning}
        emptyStateMessage={
          planning.website_url
            ? "Not analysed yet — run “Analyse Website” to capture a preview."
            : "No website on record — nothing to preview."
        }
      />
    );
  } else {
    body = (
      <EvidencePanel
        planning={planning}
        emptyStateMessage={
          hasAudit && !hasScreenshot ? "The last analysis couldn't capture a screenshot for this site." : undefined
        }
      />
    );
  }

  const captured = mode === "existing" && planning.analysed_at ? new Date(planning.analysed_at) : null;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn btn-secondary btn-sm">
        View current website
      </button>
      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)} role="presentation">
          <div
            ref={containerRef}
            tabIndex={-1}
            className="modal-panel flex max-h-[calc(100dvh-2rem)] w-[min(96vw,720px)] max-w-none flex-col p-0 focus:outline-none"
            role="dialog"
            aria-modal="true"
            aria-label="Current website preview"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5">
              <p className="text-sm font-medium text-fg">
                Current website{captured ? ` — captured ${captured.toLocaleDateString()}` : ""}
              </p>
              <button ref={closeButtonRef} type="button" onClick={() => setOpen(false)} className="btn btn-secondary btn-sm">
                Close
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4">{body}</div>
          </div>
        </div>
      )}
    </>
  );
}
