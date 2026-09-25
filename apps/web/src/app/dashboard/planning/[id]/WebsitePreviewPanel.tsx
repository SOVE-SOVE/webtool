"use client";

import { useState } from "react";
import type { Planning } from "@/lib/api";
import { ChevronDownIcon } from "@/components/ui/ControlIcons";
import { planningMode } from "../lib";
import { AnalysingPreviewPanel, EvidencePanel } from "./SidePanels";

/**
 * The persistent website-preview panel — one instance, mounted once in
 * page.tsx alongside `ProcessNav` and the active step's content (not
 * remounted when `activeStep` changes), so its own collapse state and
 * `EvidencePanel`'s internal Desktop/Mobile choice and Expand-preview
 * state both survive switching steps for free, with no extra plumbing.
 * This is also the ONE place Step 2 used to duplicate: `AuditTab` no
 * longer renders its own "Screenshots" disclosure — see the report on
 * this task for that trade-off.
 *
 * This never fetches or triggers a capture itself — it only renders
 * whatever `planning` already carries (the same fields `AuditTab` used).
 * Collapsed by default on narrower widths (see the lazy initializer
 * below) so a standard laptop width gets a drawer rather than a cramped
 * three-column squeeze; open by default at the wide desktop breakpoint,
 * where page.tsx gives it its own sidebar column.
 */
export function WebsitePreviewPanel({ planning }: { planning: Planning }) {
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      // Tailwind's `xl` breakpoint — the width at which page.tsx gives
      // this its own permanent sidebar column instead of a full-width
      // drawer row (see the grid classes in page.tsx).
      return window.matchMedia("(min-width: 1280px)").matches;
    } catch {
      return true;
    }
  });

  const mode = planningMode(planning);
  const hasAudit = planning.website_audit_id !== null;
  const isAnalysing = planning.status === "analysing";
  const hasScreenshot = Boolean(planning.screenshot_desktop_base64 || planning.screenshot_mobile_base64);

  let body;
  if (isAnalysing && !hasAudit) {
    // First-ever analysis, still running — nothing captured yet to show,
    // same "capturing…" placeholder Step 2 already used while analysing.
    body = <AnalysingPreviewPanel />;
  } else if (mode === "new" && !hasAudit) {
    // New Website Plan mode never has a screenshot (no site to preview) —
    // EvidencePanel's own empty state, with the honest reason for THIS
    // planning item rather than a generic one.
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
  const bodyId = "planning-website-preview-body";

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-left transition-colors duration-fast ease-standard hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <span className="text-sm font-medium text-fg">{open ? "Website preview" : "Show website preview"}</span>
        <ChevronDownIcon
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 text-fg-muted transition-transform duration-fast ease-standard motion-reduce:transition-none ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* `hidden` rather than unmounted — EvidencePanel's own view/expand
          state (and the analysing sweep, if that's what's showing)
          survives a collapse/reopen round trip, same convention as
          DiscoveryResultsPanel's own collapsible body. */}
      <div id={bodyId} hidden={!open} className="mt-2 space-y-1.5">
        <p className="text-xs text-fg-subtle">
          Audit screenshot{captured ? ` — captured ${captured.toLocaleDateString()}` : ""}
        </p>
        {body}
      </div>
    </div>
  );
}
