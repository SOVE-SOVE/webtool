"use client";

import Link from "next/link";
import { useState } from "react";
import { api, PLANNING_STATUS_LABELS, type PlanningChecklistSummary, type PlanningListItem } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { Density } from "@/lib/useDensity";
import { PLANNING_MODE_LABEL, STATUS_BADGE_CLASS, planningCardAction, planningListItemMode } from "@/app/dashboard/planning/lib";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * The card's website preview. Three, mutually exclusive states — never a
 * fake screenshot: a real one when the backing audit actually has one
 * (fetched from the lightweight thumbnail route, not embedded in the
 * list response); the same "inspection" sweep the detail page uses
 * while a first-ever analysis is capturing a fresh one (no previous
 * screenshot exists yet, so there's nothing else honest to show); or a
 * calm initials placeholder otherwise. A re-analysis of an item that
 * already has a screenshot keeps showing it rather than swapping to the
 * sweep — the existing screenshot is still real content, matching how
 * the detail page's own Overview keeps previous content on screen
 * during a re-run instead of showing the first-run skeleton.
 */
function PlanningPreview({ item }: { item: PlanningListItem }) {
  if (item.has_screenshot) {
    return (
      <div className="aspect-[16/10] overflow-hidden bg-surface-subtle">
        <img
          src={api.planningScreenshotUrl(item.id)}
          alt={`${item.lead_business_name} website preview`}
          loading="lazy"
          className="h-full w-full object-cover object-top"
        />
      </div>
    );
  }
  if (item.status === "analysing") {
    return (
      <div
        className="scan-surface flex aspect-[16/10] items-center justify-center bg-surface-subtle"
        role="status"
        aria-label="Capturing a fresh screenshot"
      >
        <p className="text-xs text-fg-subtle">Analysing…</p>
      </div>
    );
  }
  return (
    <div className="flex aspect-[16/10] flex-col items-center justify-center gap-1.5 bg-surface-subtle">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-medium text-accent"
      >
        {initials(item.lead_business_name)}
      </span>
      <p className="text-[11px] text-fg-subtle">No preview yet</p>
    </div>
  );
}

/** Compact "⋯" secondary-actions menu — every reachable-but-not-primary
 * shortcut for this card (the Lead it came from, the Project it was
 * transferred to, and Remove), kept out of the way of the two primary
 * navigation targets (business name, primary action). */
function CardMenu({
  item,
  onRemove,
  removing,
}: {
  item: PlanningListItem;
  onRemove: (item: PlanningListItem) => void;
  removing: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`More actions for ${item.lead_business_name}`}
        className="rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg"
      >
        ⋯
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 z-20 mt-1 w-44 rounded-md border border-border bg-surface py-1 shadow-lg">
            <Link href={`/dashboard/leads/${item.lead_id}`} className="block px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover">
              Open Lead
            </Link>
            {item.project_id && (
              <Link
                href={`/dashboard/projects/${item.project_id}`}
                className="block px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover"
              >
                Open Project
              </Link>
            )}
            <button
              type="button"
              disabled={removing}
              onClick={() => {
                setOpen(false);
                onRemove(item);
              }}
              className="block w-full px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover disabled:opacity-50"
            >
              {removing ? "Removing…" : "Remove"}
            </button>
          </div>
        </>
      )}
    </span>
  );
}

export function PlanningCard({
  item,
  checklist,
  density,
  onRemove,
  removing,
}: {
  item: PlanningListItem;
  checklist: PlanningChecklistSummary | undefined;
  density: Density;
  onRemove: (item: PlanningListItem) => void;
  removing: boolean;
}) {
  const mode = planningListItemMode(item);
  const action = planningCardAction(item);
  const locationParts = [item.lead_industry, [item.lead_suburb, item.lead_state].filter(Boolean).join(", ")].filter(
    (p) => p && p.trim().length > 0,
  );
  const padY = density === "compact" ? "p-2.5" : "p-3";
  const href = `/dashboard/planning/${item.id}`;

  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-border bg-surface transition-colors hover:border-border-strong">
      <Link href={href} tabIndex={-1} aria-hidden="true">
        <PlanningPreview item={item} />
      </Link>
      <div className={`flex flex-1 flex-col gap-1.5 ${padY}`}>
        <div className="flex items-start justify-between gap-1.5">
          <Link
            href={href}
            title={item.lead_business_name}
            className="min-w-0 truncate font-medium text-fg hover:underline"
          >
            {item.lead_business_name}
          </Link>
          <CardMenu item={item} onRemove={onRemove} removing={removing} />
        </div>

        {locationParts.length > 0 && <p className="truncate text-xs text-fg-muted">{locationParts.join(" · ")}</p>}

        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_BADGE_CLASS[item.status]}`}>
            {PLANNING_STATUS_LABELS[item.status]}
          </span>
          {item.status === "analysing" && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent motion-safe:animate-pulse" aria-hidden="true" />
          )}
          <span className="rounded bg-surface-subtle px-1.5 py-0.5 text-[11px] font-medium text-fg-muted">
            {PLANNING_MODE_LABEL[mode]}
          </span>
          {item.project_id && (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
              Transferred
            </span>
          )}
        </div>

        {/* Checklist progress: omitted entirely (not a 0%) when the item
            has no checklist summary yet — e.g. the bulk endpoint hasn't
            resolved, or genuinely has no items. */}
        {checklist && checklist.total > 0 && (
          <div className="mt-0.5">
            <div className="h-1 w-full overflow-hidden rounded-full bg-surface-subtle">
              <div className="h-full rounded-full bg-accent" style={{ width: `${checklist.pct ?? 0}%` }} />
            </div>
            <p className="mt-1 text-[11px] text-fg-muted">
              {checklist.completed}/{checklist.total} tasks
            </p>
          </div>
        )}

        {checklist?.next_item_title && (
          <p className="truncate text-xs text-fg-muted" title={checklist.next_item_title}>
            Next: {checklist.next_item_title}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <span className="shrink-0 text-[11px] text-fg-subtle">{timeAgo(item.updated_at)}</span>
          <Link
            href={href}
            className={`btn btn-sm shrink-0 ${action.kind === "analyse" || action.kind === "generate" ? "btn-primary" : "btn-secondary"}`}
          >
            {action.label}
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Skeleton matching PlanningCard's own layout — shown while the list is
 * still loading, so the swap to real cards is a content change, not a
 * layout jump. */
export function PlanningCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-border bg-surface">
      <div className="skeleton aspect-[16/10] rounded-none" />
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="skeleton h-4 w-2/3" />
        <div className="skeleton h-3 w-1/2" />
        <div className="skeleton h-4 w-24" />
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <div className="skeleton h-3 w-12" />
          <div className="skeleton h-7 w-24" />
        </div>
      </div>
    </div>
  );
}
