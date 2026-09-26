"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { ChevronDownIcon } from "@/components/ui/ControlIcons";
import { ListSkeleton } from "@/components/ui/Skeleton";
import {
  DISCOVERED_WEBSITE_STATUS_LABEL,
  INSTAGRAM_CHECK_STATE_LABEL,
  instagramCheckDisplayState,
  type DiscoveredBusiness,
  type InstagramCheckState,
} from "@/lib/api";
import { hasCoordinates } from "@/lib/filters";

// Same two status vocabularies the old results table used (see
// DiscoveryWorkspace's git history) — moved here since this panel is
// now the only place that renders a business's website/social status.
const WEBSITE_BADGE: Record<DiscoveredBusiness["website_status"], BadgeTone> = {
  found: "muted",
  none: "highlight",
  unknown: "muted",
};
const INSTAGRAM_CHECK_STATE_BADGE: Record<InstagramCheckState, BadgeTone> = {
  website_found: "success",
  no_website_found: "highlight",
  link_in_bio_only: "info",
  check_pending: "warning",
  needs_review: "muted",
};

export type DiscoveryResultsPanelItem = {
  business: DiscoveredBusiness;
  /** Just landed since the last poll/filter change — gets a brief fade-in. */
  isNew: boolean;
  animationDelayMs: number;
};

function QueueAction({
  business,
  busy,
  onQueue,
  onUnqueue,
}: {
  business: DiscoveredBusiness;
  busy: boolean;
  onQueue: () => void;
  onUnqueue: () => void;
}) {
  if (business.status === "imported" && business.imported_lead_id) {
    return (
      <Link href={`/dashboard/leads/${business.imported_lead_id}`} className="text-xs text-fg-muted hover:underline">
        View lead &rarr;
      </Link>
    );
  }
  if (business.review_queued_at) {
    return (
      <span className="flex items-center gap-1.5 text-xs">
        <span className="font-medium text-fg-muted">In review queue</span>
        <button
          type="button"
          onClick={onUnqueue}
          disabled={busy}
          className="text-fg-subtle hover:underline disabled:opacity-50"
        >
          Remove
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onQueue}
      disabled={busy}
      className="text-xs font-medium text-fg hover:underline disabled:opacity-50"
    >
      {busy ? "Adding…" : "Add to review queue"}
    </button>
  );
}

function ResultRow({
  item,
  selected,
  busy,
  onSelect,
  onQueue,
  onUnqueue,
  registerRef,
}: {
  item: DiscoveryResultsPanelItem;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onQueue: () => void;
  onUnqueue: () => void;
  registerRef: (el: HTMLDivElement | null) => void;
}) {
  const { business, isNew, animationDelayMs } = item;
  const onMap = hasCoordinates(business);
  const secondary = [business.business_category || business.industry, business.suburb].filter(Boolean).join(" · ");
  const igState = instagramCheckDisplayState(business);
  const statusTone = igState ? INSTAGRAM_CHECK_STATE_BADGE[igState] : WEBSITE_BADGE[business.website_status];
  const statusLabel = igState ? INSTAGRAM_CHECK_STATE_LABEL[igState] : DISCOVERED_WEBSITE_STATUS_LABEL[business.website_status];

  return (
    <div
      ref={registerRef}
      onClick={(e) => {
        // A mapped business is a shortcut to select its marker — but
        // never steals a click meant for the link/buttons inside.
        if (!onMap) return;
        if ((e.target as HTMLElement).closest("a, button")) return;
        onSelect();
      }}
      aria-current={selected ? "true" : undefined}
      className={`border-l-2 px-3 py-2.5 transition-colors duration-fast ease-standard motion-reduce:transition-none ${
        onMap ? "cursor-pointer hover:bg-[var(--glass-fill)]" : ""
      } ${selected ? "border-l-accent bg-accent-soft" : "border-l-transparent"} ${isNew ? "animate-fade-in" : ""}`}
      style={isNew ? { animationDelay: `${animationDelayMs}ms`, animationFillMode: "backwards" } : undefined}
    >
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 truncate text-sm font-medium text-fg" title={business.name}>
          {business.name}
        </span>
        {onMap && (
          <span className="shrink-0 text-fg-subtle" title="On the map" aria-hidden>
            &#9679;
          </span>
        )}
      </div>
      <p className="mt-0.5 truncate text-xs text-fg-muted">{secondary || "No category on record"}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge tone={statusTone}>{statusLabel}</Badge>
        {business.instagram_handle && (
          <a
            href={business.instagram_profile_url ?? undefined}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-fg-subtle hover:underline"
          >
            @{business.instagram_handle}
          </a>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <Link
          href={`/dashboard/discovered-businesses/${business.id}`}
          className="text-xs text-fg-subtle hover:underline"
        >
          View details
        </Link>
        <QueueAction
          business={business}
          busy={busy}
          onQueue={onQueue}
          onUnqueue={onUnqueue}
        />
      </div>
    </div>
  );
}

/**
 * The Map Discovery results panel: a compact, internally-scrolling list
 * floating over the map, replacing the old full-width transparent table
 * (see docs/07_SESSION_LOG.md for the redesign this came out of).
 *
 * Collapsed or expanded, it takes the same `.map-glass` frosted
 * treatment as the other floating controls (nav bar, search panel).
 * `.map-glass-controls` makes the command bar's controls and the footer
 * button sit on the glass too, and rows/dividers use the translucent
 * --glass-fill/--glass-hairline tokens rather than opaque surfaces. Text
 * contrast over the map comes from --glass-bg plus the panel's scoped
 * --fg-muted/--fg-subtle overrides (see globals.css).
 *
 * Owns its own collapse state's presentation (the caller owns the
 * boolean) and, internally, scrolling the selected business into view —
 * everything else (what to show: loading/empty/error/list) is handed
 * down already decided, since that branching belongs with the data
 * fetching in DiscoveryWorkspace.
 */
export function DiscoveryResultsPanel({
  open,
  onOpenChange,
  resultCount,
  commandBar,
  statusInfo,
  banner,
  loading,
  emptyMessage,
  emptyAction,
  items,
  selectedId,
  onSelect,
  queuingId,
  onQueue,
  onUnqueue,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shown on the collapsed control ("Show results (N)"); null while unknown. */
  resultCount: number | null;
  commandBar?: ReactNode;
  statusInfo?: ReactNode;
  banner?: ReactNode;
  loading: boolean;
  emptyMessage?: string | null;
  emptyAction?: ReactNode;
  items: DiscoveryResultsPanelItem[] | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  queuingId: string | null;
  onQueue: (business: DiscoveredBusiness) => void;
  onUnqueue: (business: DiscoveredBusiness) => void;
  footer?: ReactNode;
}) {
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Bring the selected business's row into view — on a genuine change
  // of selection only, never merely on reopening. Reopening a panel the
  // operator scrolled somewhere else must land back exactly where they
  // left it (see the collapse behaviour's own scroll-position
  // requirement), not jump to whatever is currently selected.
  // `scrollIntoView` on a row inside the still-`hidden` body is a no-op
  // (nothing rendered to scroll), so a selection made while collapsed
  // simply catches up next time it actually changes.
  useEffect(() => {
    if (!selectedId) return;
    rowRefs.current.get(selectedId)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  const bodyId = "discovery-results-body";

  return (
    <div
      // `min-h-11` keeps at least the toggle row when an expanded search
      // form above takes most of a short column (high zoom, landscape phone).
      className={`map-glass map-glass-controls pointer-events-auto flex min-h-11 flex-col overflow-hidden ${
        open ? "flex-1" : "shrink-0"
      }`}
    >
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-controls={bodyId}
        // The button sits directly on `.map-glass` — a background-color
        // hover paints an extra white layer over the backdrop-blur and
        // reads as a solid flash. An inset ring in the glass border colour
        // gives a hover affordance while the frosted look stays identical.
        className="flex w-full shrink-0 items-center justify-between gap-3 px-3 py-2.5 text-left transition-[box-shadow] duration-fast ease-standard motion-reduce:transition-none hover:shadow-[inset_0_0_0_1px_var(--glass-border)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset"
      >
        <span className="text-sm font-medium text-fg">
          {open ? "Results" : resultCount !== null ? `Show results (${resultCount})` : "Show results"}
        </span>
        <ChevronDownIcon
          className={`h-4 w-4 shrink-0 text-fg-muted transition-transform duration-fast ease-standard motion-reduce:transition-none ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* `hidden` (not unmounted) so the list's scroll position, and
          every row's own state, survive a collapse/reopen round trip.
          `animate-rise-in` replays every time this goes from
          display:none back to flex — a materialize-in on reopen, no
          animated exit, the same "enter only" convention .modal-panel
          uses (see globals.css) rather than something new.
          Normally only the list scrolls. On a short viewport (high browser
          zoom, landscape phone) the list keeps a floor of its own
          height rather than shrinking to nothing under the fixed-height
          header/command bar, and this body scrolls as a whole instead —
          so nothing is clipped by the panel's `overflow-hidden`. */}
      <div
        id={bodyId}
        hidden={!open}
        className="animate-rise-in flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain border-t border-[var(--glass-hairline)]"
      >
        {(banner || statusInfo || commandBar) && (
          <div className="shrink-0 space-y-2.5 border-b border-[var(--glass-hairline)] px-3 py-2.5">
            {banner}
            {statusInfo}
            {commandBar}
          </div>
        )}

        <div className="min-h-[min(15rem,50dvh)] flex-1 overflow-y-auto">
          {loading ? (
            <ListSkeleton rows={4} />
          ) : emptyMessage ? (
            <div className="px-3 py-8 text-center">
              <p className="text-sm text-fg-muted">{emptyMessage}</p>
              {emptyAction && <div className="mt-3 flex justify-center">{emptyAction}</div>}
            </div>
          ) : (
            <div className="divide-y divide-[var(--glass-hairline)]">
              {items?.map((item) => (
                <ResultRow
                  key={item.business.id}
                  item={item}
                  selected={item.business.id === selectedId}
                  busy={queuingId === item.business.id}
                  onSelect={() => onSelect(item.business.id)}
                  onQueue={() => onQueue(item.business)}
                  onUnqueue={() => onUnqueue(item.business)}
                  registerRef={(el) => {
                    if (el) rowRefs.current.set(item.business.id, el);
                    else rowRefs.current.delete(item.business.id);
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {footer && <div className="shrink-0 border-t border-[var(--glass-hairline)] px-3 py-2">{footer}</div>}
      </div>
    </div>
  );
}
