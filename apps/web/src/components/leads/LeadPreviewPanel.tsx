"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, PROJECT_STAGE_LABELS, type Business, type Lead } from "@/lib/api";
import { LeadStatusBadge } from "@/components/LeadStatusBadge";
import { useDismissableOverlay } from "@/lib/useDismissableOverlay";

function socialLinkLines(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Quick-look side panel opened from the Leads list ("Preview" action,
 * desktop only). Renders instantly from the already-loaded `Lead` —
 * the list's own listLeads() response already carries everything but
 * social links, which come from one extra getBusiness() fetch on open.
 */
export function LeadPreviewPanel({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const router = useRouter();
  const [business, setBusiness] = useState<Business | null>(null);
  const [startingPlanning, setStartingPlanning] = useState(false);
  const [startPlanningError, setStartPlanningError] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { containerRef } = useDismissableOverlay({ open: true, onClose, initialFocusRef: closeButtonRef });

  useEffect(() => {
    let alive = true;
    api
      .getBusiness(lead.business_id)
      .then((b) => alive && setBusiness(b))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [lead.business_id]);

  async function handleStartPlanning() {
    setStartingPlanning(true);
    setStartPlanningError(null);
    try {
      const planning = await api.startPlanning(lead.id);
      router.push(`/dashboard/planning/${planning.id}?name=${encodeURIComponent(lead.business_name)}`);
    } catch {
      setStartPlanningError("Couldn't open Planning for this lead.");
      setStartingPlanning(false);
    }
  }

  const location = [lead.suburb, lead.state].filter(Boolean).join(", ");
  const primaryAction = lead.prospect_project ? (
    <Link href={`/dashboard/projects/${lead.prospect_project.id}`} className="btn btn-primary btn-sm">
      Open Project →
    </Link>
  ) : lead.planning_id ? (
    <Link href={`/dashboard/planning/${lead.planning_id}`} className="btn btn-primary btn-sm">
      Open Planning →
    </Link>
  ) : (
    <button type="button" onClick={handleStartPlanning} disabled={startingPlanning} className="btn btn-primary btn-sm">
      {startingPlanning ? "Opening…" : "Start Planning →"}
    </button>
  );

  return (
    <div className="side-panel-overlay" onClick={onClose}>
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Preview — ${lead.business_name}`}
        className="side-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-fg">{lead.business_name}</h2>
            {(lead.industry || location) && (
              <p className="mt-0.5 truncate text-xs text-fg-muted">
                {[lead.industry, location].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="shrink-0 rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path d="M4.22 4.22a.75.75 0 0 1 1.06 0L10 8.94l4.72-4.72a.75.75 0 1 1 1.06 1.06L11.06 10l4.72 4.72a.75.75 0 1 1-1.06 1.06L10 11.06l-4.72 4.72a.75.75 0 0 1-1.06-1.06L8.94 10 4.22 5.28a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <div className="flex items-center gap-1.5">
            <LeadStatusBadge status={lead.status} />
            {lead.planning_id && (
              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-500/15 dark:text-blue-300">
                In Planning
              </span>
            )}
          </div>

          <div className="space-y-1.5 text-sm">
            {lead.website_url ? (
              <a href={lead.website_url} target="_blank" rel="noreferrer" className="block text-fg hover:underline">
                {lead.website_url}
              </a>
            ) : (
              <p className="text-fg-subtle">No website on record</p>
            )}
            {lead.business_phone && (
              <a href={`tel:${lead.business_phone}`} className="block text-fg-muted hover:text-fg hover:underline">
                {lead.business_phone}
              </a>
            )}
            {lead.business_email && (
              <a href={`mailto:${lead.business_email}`} className="block text-fg-muted hover:text-fg hover:underline">
                {lead.business_email}
              </a>
            )}
          </div>

          {business && socialLinkLines(business.social_links).length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Social</p>
              <div className="mt-1 space-y-1">
                {socialLinkLines(business.social_links).map((url, i) => (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-sm text-fg-muted hover:text-fg hover:underline"
                  >
                    {url}
                  </a>
                ))}
              </div>
            </div>
          )}

          {(lead.planning_id || lead.prospect_project || lead.client_id) && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Linked</p>
              <div className="mt-1 space-y-1 text-sm">
                {lead.prospect_project && (
                  <Link href={`/dashboard/projects/${lead.prospect_project.id}`} className="block text-fg hover:underline">
                    {lead.prospect_project.name} — {PROJECT_STAGE_LABELS[lead.prospect_project.stage]}
                  </Link>
                )}
                {lead.planning_id && (
                  <Link href={`/dashboard/planning/${lead.planning_id}`} className="block text-fg hover:underline">
                    Planning workspace →
                  </Link>
                )}
                {lead.client_id && (
                  <Link href={`/dashboard/clients/${lead.client_id}`} className="block text-fg hover:underline">
                    Open client →
                  </Link>
                )}
              </div>
            </div>
          )}

          {startPlanningError && <p className="text-error">{startPlanningError}</p>}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border p-4">
          <Link href={`/dashboard/leads/${lead.id}`} className="text-sm text-fg-muted hover:text-fg hover:underline">
            Open full details →
          </Link>
          {primaryAction}
        </div>
      </div>
    </div>
  );
}
