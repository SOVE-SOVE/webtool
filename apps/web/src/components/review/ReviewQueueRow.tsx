"use client";

import Link from "next/link";
import type { DiscoveredBusinessReviewItem } from "@/lib/api";
import { Checkbox } from "@/components/ui/Checkbox";
import { Skeleton } from "@/components/ui/Skeleton";
import { RowMenu, type RowMenuItem } from "@/components/review/RowMenu";
import {
  formatReviewScore,
  REVIEW_ANALYSIS_STATE_LABEL,
  REVIEW_ANALYSIS_STATE_TITLE,
  REVIEW_WEBSITE_STATE_LABEL,
  reviewAnalysisState,
  reviewWebsiteState,
  type ReviewAnalysisState,
  type ReviewWebsiteState,
} from "@/lib/reviewQueue";
import { STATUS_LABEL } from "@/components/ReviewStatusBadge";

/**
 * One grid template shared by the header, rows and skeleton so columns
 * can never drift apart. Below `md` the row collapses to name + status
 * line + actions instead of scrolling sideways.
 */
export const REVIEW_ROW_GRID =
  "grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-3 md:grid-cols-[1.25rem_minmax(0,1fr)_8.5rem_8.5rem_6rem_9rem_2rem]";

const DOT: Record<string, string> = {
  good: "bg-emerald-500",
  bad: "bg-red-500",
  warn: "bg-amber-500",
  idle: "bg-fg-subtle/60",
};

function StatusText({ tone, children, title }: { tone: keyof typeof DOT; children: React.ReactNode; title?: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-fg-muted" title={title}>
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[tone]}`} />
      <span className="truncate">{children}</span>
    </span>
  );
}

// Only "no website" gets a colour: nothing about a listed URL or a social
// profile has been verified, so neither may look like a green "good" state.
const WEBSITE_TONE: Record<ReviewWebsiteState, keyof typeof DOT> = { listed: "idle", social: "idle", none: "warn", check: "idle" };
const WEBSITE_TITLE: Record<ReviewWebsiteState, string> = {
  listed: "A website URL is on record — it hasn't been checked, so it may be down, wrong, or out of date",
  social: "The listed URL is a social/link-hub profile, not an owned website",
  none: "Searches found no website — evidence, not proof",
  check: "Website status hasn't been confirmed yet",
};
const ANALYSIS_TONE: Record<ReviewAnalysisState, keyof typeof DOT> = {
  done: "good",
  failed: "warn",
  not_run: "idle",
  not_applicable: "idle",
};

export function ReviewQueueRowSkeleton() {
  return (
    <div className={`${REVIEW_ROW_GRID} h-[3.25rem] px-3`} aria-hidden>
      <Skeleton className="h-3.5 w-3.5" />
      <div className="space-y-1.5">
        <Skeleton className="h-3 w-2/5" />
        <Skeleton className="h-2.5 w-1/4" />
      </div>
      <Skeleton className="hidden h-3 w-20 md:block" />
      <Skeleton className="hidden h-3 w-20 md:block" />
      <Skeleton className="hidden h-3 w-8 md:block" />
      <Skeleton className="h-7 w-24" />
      <Skeleton className="hidden h-6 w-6 md:block" />
    </div>
  );
}

export function ReviewQueueHeader({
  allSelected,
  someSelected,
  onToggleAll,
  disabled,
}: {
  allSelected: boolean;
  someSelected: boolean;
  onToggleAll: () => void;
  disabled: boolean;
}) {
  return (
    <div
      className={`${REVIEW_ROW_GRID} border-b border-border bg-surface-subtle px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-muted`}
    >
      <Checkbox
        checked={allSelected}
        ref={(el) => {
          if (el) el.indeterminate = someSelected && !allSelected;
        }}
        onChange={onToggleAll}
        disabled={disabled}
        aria-label="Select all shown"
      />
      <span>Business</span>
      <span className="hidden md:block">Website</span>
      <span className="hidden md:block">Analysis</span>
      <span className="hidden md:block">Opportunity</span>
      <span className="col-span-1 md:col-span-2" />
    </div>
  );
}

export function ReviewQueueRow({
  item,
  href,
  selected,
  removing,
  onRemove,
  onToggleSelect,
  onOpen,
}: {
  item: DiscoveredBusinessReviewItem;
  href: string;
  selected: boolean;
  removing: boolean;
  onRemove: () => void;
  onToggleSelect: () => void;
  onOpen: () => void;
}) {
  const imported = item.status === "imported";
  const websiteState = reviewWebsiteState(item);
  const analysisState = reviewAnalysisState(item);
  const secondary =
    [item.business_category || item.industry, [item.suburb, item.state].filter(Boolean).join(", ")]
      .filter(Boolean)
      .join(" · ") || "No details on record";
  const scored = item.opportunity_score !== null && item.opportunity_score !== undefined;
  const scoreTitle = scored
    ? `Opportunity score ${item.opportunity_score}${item.score_category ? ` (${item.score_category})` : ""} out of 100 — higher means a stronger web-design opportunity`
    : "No opportunity score: the site hasn't been assessed, or the check couldn't complete";

  const menuItems: RowMenuItem[] = [{ kind: "link", label: "Open full review", href }];
  if (imported && item.imported_lead_id) {
    menuItems.push({ kind: "link", label: "View lead", href: `/dashboard/leads/${item.imported_lead_id}` });
  } else if (!imported) {
    menuItems.push({ kind: "action", label: "Remove from queue", danger: true, disabled: removing, onSelect: onRemove });
  }

  const websiteLabel =
    websiteState === "social" && item.website_platform
      ? `${item.website_platform} profile`
      : REVIEW_WEBSITE_STATE_LABEL[websiteState];
  const analysisLabel = REVIEW_ANALYSIS_STATE_LABEL[analysisState];
  const analysisTitle = REVIEW_ANALYSIS_STATE_TITLE[analysisState];

  return (
    <div
      onClick={(e) => {
        // Whole row is a shortcut to the review page, but never steals a
        // click meant for a control inside it.
        if ((e.target as HTMLElement).closest("a, button, input, [role=menu]")) return;
        onOpen();
      }}
      className={`${REVIEW_ROW_GRID} cursor-pointer px-3 py-2 hover:bg-surface-hover focus-within:bg-surface-hover ${
        selected ? "bg-surface-subtle" : ""
      }`}
    >
      {imported ? (
        <span className="block h-4 w-4" />
      ) : (
        <Checkbox checked={selected} onChange={onToggleSelect} aria-label={`Select ${item.name}`} />
      )}

      <div className="min-w-0">
        <Link
          href={href}
          title={item.name}
          className="block truncate text-sm font-semibold text-fg hover:underline focus-visible:underline"
        >
          {item.name}
        </Link>
        <p className="truncate text-xs text-fg-muted" title={secondary}>
          {secondary}
        </p>
        {/* Mobile: the key statuses that get their own columns on desktop. */}
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 md:hidden">
          <StatusText tone={WEBSITE_TONE[websiteState]}>{websiteLabel}</StatusText>
          <StatusText tone={ANALYSIS_TONE[analysisState]} title={analysisTitle}>{analysisLabel}</StatusText>
          <span className="text-xs tabular-nums text-fg-muted" title={scoreTitle}>
            {scored ? `Opportunity ${item.opportunity_score}` : formatReviewScore(item.opportunity_score)}
          </span>
          {imported && <span className="text-xs text-fg-muted">{STATUS_LABEL.imported}</span>}
        </p>
      </div>

      <div className="hidden md:block">
        <StatusText tone={WEBSITE_TONE[websiteState]} title={WEBSITE_TITLE[websiteState]}>
          {websiteLabel}
        </StatusText>
      </div>
      <div className="hidden md:block">
        <StatusText tone={ANALYSIS_TONE[analysisState]} title={analysisTitle}>
          {analysisLabel}
        </StatusText>
      </div>
      <div
        className={`hidden truncate text-xs tabular-nums md:block ${scored ? "text-fg-muted" : "text-fg-subtle"}`}
        title={scoreTitle}
        aria-label={scoreTitle}
      >
        {scored ? `${item.opportunity_score}/100` : formatReviewScore(item.opportunity_score)}
      </div>

      <div className="flex items-center justify-end gap-1 md:contents">
        <div className="md:justify-self-end">
          {imported && item.imported_lead_id ? (
            <Link href={`/dashboard/leads/${item.imported_lead_id}`} className="btn btn-secondary btn-sm min-h-8">
              View lead
            </Link>
          ) : (
            <Link href={href} className="btn btn-secondary btn-sm min-h-8" aria-label={`Review business: ${item.name}`}>
              Review business
            </Link>
          )}
        </div>
        <RowMenu label={`More actions for ${item.name}`} items={menuItems} />
      </div>
    </div>
  );
}
