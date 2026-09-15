"use client";

import Link from "next/link";
import { useRef } from "react";
import { useDismissableOverlay } from "@/lib/useDismissableOverlay";
import { ClientStatusBadge } from "@/components/ClientStatusBadge";
import { ProjectStatusBadge } from "@/components/ProjectStatusBadge";
import { HostingField, NextPaymentField, NextTaskField, type EnrichedClient } from "./ClientRowFields";

/**
 * Quick-look side panel for one Overview-tab row — opens without
 * leaving the list (same URL-param-driven, dismissable-overlay pattern
 * as Leads' own preview panel and the Revenue tab's payment detail
 * panel), built entirely from data the Overview tab already has in
 * memory for every row — no extra fetch just to open this.
 */
export function ClientPreviewPanel({
  row,
  currency,
  onClose,
}: {
  row: EnrichedClient;
  currency: string;
  onClose: () => void;
}) {
  const { client, tone, allProjects } = row;
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { containerRef } = useDismissableOverlay({ open: true, onClose, initialFocusRef: closeButtonRef });

  return (
    <div className="side-panel-overlay" onClick={onClose}>
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Preview — ${client.business_name}`}
        className="side-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-fg">{client.business_name}</h2>
            <div className="mt-1">
              <ClientStatusBadge tone={tone} />
            </div>
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
          <div>
            <p className="text-xs text-fg-muted">Contact</p>
            <p className="text-sm text-fg">{client.billing_email ?? "No contact on file"}</p>
          </div>

          <div>
            <p className="text-xs text-fg-muted">Assigned to</p>
            <p className="text-sm text-fg">{client.assigned_user_name ?? "Unassigned"}</p>
          </div>

          <div>
            <p className="text-xs text-fg-muted">Projects &amp; websites</p>
            {allProjects.length === 0 ? (
              <p className="text-sm text-fg-subtle">No projects yet.</p>
            ) : (
              <ul className="mt-1 space-y-1.5">
                {allProjects.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/dashboard/projects/${p.id}`}
                      className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm hover:bg-surface-hover"
                    >
                      <span className="min-w-0 truncate text-fg">{p.name}</span>
                      <ProjectStatusBadge project={p} className="shrink-0" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="text-xs text-fg-muted">Hosting</p>
            <p className="text-sm">
              <HostingField row={row} currency={currency} />
            </p>
          </div>

          <div>
            <p className="text-xs text-fg-muted">Next payment</p>
            <p className="text-sm">
              <NextPaymentField row={row} currency={currency} />
            </p>
          </div>

          <div>
            <p className="text-xs text-fg-muted">Next task</p>
            <p className="text-sm">
              <NextTaskField row={row} />
            </p>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border p-4">
          <Link href={`/dashboard/clients/${client.id}?tab=billing`} className="btn btn-secondary btn-sm">
            Billing
          </Link>
          <Link href={`/dashboard/clients/${client.id}`} className="btn btn-primary btn-sm">
            Open Client →
          </Link>
        </div>
      </div>
    </div>
  );
}
