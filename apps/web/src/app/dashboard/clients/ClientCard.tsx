"use client";

import Link from "next/link";
import { useState } from "react";
import { relativeObligationLabel } from "@/lib/billing";
import { formatMoney } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { ClientStatusBadge } from "@/components/ClientStatusBadge";
import { ThumbnailPlaceholder } from "@/components/ui/ThumbnailPlaceholder";
import { WebsitesField, HostingField, type EnrichedClient } from "./ClientRowFields";

/**
 * The card's website preview. No screenshot/thumbnail capability exists
 * anywhere in this codebase for a generated website (see
 * ThumbnailPlaceholder's own docstring) — this always renders the
 * shared placeholder. There is also no "primary site" designation on
 * Project anywhere in the backend, so for a client with more than one
 * live site this deliberately does not pick one to feature (that would
 * be the "arbitrary" pick the design explicitly rules out) — the label
 * just states the honest count instead.
 */
function ClientCardPreview({ row }: { row: EnrichedClient }) {
  const label =
    row.liveProjects.length === 0
      ? "No live website yet"
      : row.liveProjects.length === 1
        ? "Live website — no preview image"
        : `${row.liveProjects.length} live websites`;
  return <ThumbnailPlaceholder label={label} />;
}

/**
 * One short line: the single highest-priority thing to do next for this
 * client. Same precedence AttentionIndicator already used (overdue
 * payment first, then outstanding required tasks), falling through to
 * the ordinary "what's next" a client with no open issues still has —
 * never two lines, never every issue listed.
 */
function cardNextAction(row: EnrichedClient, currency: string): string {
  if (row.nextPayment?.is_overdue) {
    return `Overdue payment — ${formatMoney(row.nextPayment.amount_cents, currency)}, ${relativeObligationLabel(row.nextPayment)}`;
  }
  if (row.requiredOutstanding > 0) {
    return `${row.requiredOutstanding} required task${row.requiredOutstanding === 1 ? "" : "s"} outstanding`;
  }
  if (!row.project) return "Start intake";
  if (!row.nextTask) return "No open tasks";
  return row.nextTask.title;
}

/** Eye icon — the explicit, always-visible quick-preview trigger, distinct from the "⋯" menu (which navigates away; this opens a panel without leaving the grid). */
function PreviewButton({ row, onOpen }: { row: EnrichedClient; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpen();
      }}
      aria-label={`Quick preview of ${row.client.business_name}`}
      className="rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg"
    >
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4" aria-hidden="true">
        <path d="M2.5 10S5.5 4.5 10 4.5 17.5 10 17.5 10 14.5 15.5 10 15.5 2.5 10 2.5 10Z" />
        <circle cx="10" cy="10" r="2" />
      </svg>
    </button>
  );
}

/** Compact "⋯" secondary-actions menu — every existing shortcut into
 * this client's own record (Open Client, Billing, Edit details), same
 * items RowActionsMenu already offered from the table. No Archive here:
 * Client has no archive concept anywhere in this codebase. */
function CardMenu({ row }: { row: EnrichedClient }) {
  const [open, setOpen] = useState(false);
  const { client } = row;
  return (
    <span className="relative inline-block shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`More actions for ${client.business_name}`}
        className="rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg"
      >
        ⋯
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="menu-panel absolute right-0 z-20 mt-1 w-44 rounded-md border border-border bg-surface py-1 shadow-lg">
            <Link href={`/dashboard/clients/${client.id}`} className="block px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover">
              Open Client
            </Link>
            <Link href={`/dashboard/clients/${client.id}?tab=billing`} className="block px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover">
              Billing
            </Link>
            <Link href={`/dashboard/clients/${client.id}?tab=details`} className="block px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover">
              Edit details
            </Link>
          </div>
        </>
      )}
    </span>
  );
}

export function ClientCard({
  row,
  currency,
  issueCount,
  isPreviewOpen,
  onOpenPreview,
}: {
  row: EnrichedClient;
  currency: string;
  /** Total distinct issues behind this client's attention state (overdue payments + a required-tasks-outstanding group), from the same grouping buildAttentionCards already does — 0 when the client needs no attention. */
  issueCount: number;
  isPreviewOpen: boolean;
  onOpenPreview: () => void;
}) {
  const { client, tone } = row;
  const href = `/dashboard/clients/${client.id}`;

  return (
    <div
      className={`card-interactive flex flex-col overflow-hidden rounded-md border bg-surface ${
        isPreviewOpen ? "border-accent" : "border-border hover:border-border-strong"
      }`}
    >
      <Link href={href} tabIndex={-1} aria-hidden="true">
        <ClientCardPreview row={row} />
      </Link>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <div className="flex items-start justify-between gap-1.5">
          <Link href={href} title={client.business_name} className="min-w-0 truncate font-medium text-fg hover:underline">
            {client.business_name}
          </Link>
          <span className="flex shrink-0 items-center gap-0.5">
            <PreviewButton row={row} onOpen={onOpenPreview} />
            <CardMenu row={row} />
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <ClientStatusBadge tone={tone} />
          {issueCount > 0 && (
            <Badge tone="danger">
              {issueCount} item{issueCount === 1 ? "" : "s"} need{issueCount === 1 ? "s" : ""} attention
            </Badge>
          )}
        </div>

        <p className="text-xs text-fg-muted">
          <WebsitesField row={row} /> <span className="text-fg-subtle">·</span> <HostingField row={row} currency={currency} />
        </p>

        <p className="truncate text-xs text-fg-muted" title={cardNextAction(row, currency)}>
          <span className="text-fg-subtle">Next: </span>
          {cardNextAction(row, currency)}
        </p>

        <div className="mt-auto flex items-center justify-end gap-2 pt-2">
          <Link href={href} className="btn btn-secondary btn-sm shrink-0">
            Open Client →
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Skeleton matching ClientCard's own layout — same shape as the Build
 * workspace's PlanningCardSkeleton/ProjectCardSkeleton — so the swap to
 * real cards is a content change, not a layout jump. */
export function ClientCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-border bg-surface">
      <div className="skeleton aspect-[16/10] rounded-none" />
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="skeleton h-4 w-2/3" />
        <div className="skeleton h-4 w-24" />
        <div className="skeleton h-3 w-1/2" />
        <div className="skeleton h-3 w-3/4" />
        <div className="mt-auto flex items-center justify-end gap-2 pt-2">
          <div className="skeleton h-7 w-24" />
        </div>
      </div>
    </div>
  );
}
