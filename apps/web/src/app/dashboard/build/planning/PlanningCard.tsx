"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type RefObject } from "react";
import { api, PLANNING_STATUS_LABELS, type PlanningChecklistSummary, type PlanningListItem } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { Density } from "@/lib/useDensity";
import { Badge } from "@/components/ui/Badge";
import { PLANNING_MODE_LABEL, STATUS_BADGE_TONE, planningCardAction, planningListItemMode } from "@/app/dashboard/planning/lib";
// The Clients Overview card's flip, reused as-is: the same hover delay,
// leave grace, Details/Back rules, reduced-motion swap and timer cleanup.
import { faceExposure, FLIP_MS } from "@/app/dashboard/clients/cardFlip";
import { useCardFlip } from "@/app/dashboard/clients/useCardFlip";
import { planningCardBack } from "./planningCardBack";
import { Tooltip } from "@/components/ui/Tooltip";
import { ScreenshotImage } from "@/components/ui/ScreenshotImage";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function PreviewInitials({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-medium text-accent"
    >
      {initials(name)}
    </span>
  );
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
 * during a re-run instead of showing the first-run skeleton. A stored
 * screenshot that fails to load says so ("Preview unavailable") rather
 * than claiming there is none yet.
 */
function PlanningPreview({ item }: { item: PlanningListItem }) {
  if (item.has_screenshot) {
    return (
      <div className="aspect-[16/10] overflow-hidden bg-surface-subtle">
        <ScreenshotImage
          src={api.planningScreenshotUrl(item.id)}
          alt={`${item.lead_business_name} website preview`}
          loading="lazy"
          className="h-full w-full object-cover object-top"
          fallback={
            <div className="flex h-full flex-col items-center justify-center gap-1.5">
              <PreviewInitials name={item.lead_business_name} />
              <p className="text-[11px] text-fg-subtle">Preview unavailable</p>
            </div>
          }
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
      <PreviewInitials name={item.lead_business_name} />
      <p className="text-[11px] text-fg-subtle">No preview yet</p>
    </div>
  );
}

/** Compact "⋯" secondary-actions menu — every reachable-but-not-primary
 * shortcut for this card (the Lead it came from, the Project it was
 * transferred to, and Remove), kept out of the way of the two primary
 * navigation targets (business name, primary action). Controlled by the
 * card, which must know it's open (an open menu blocks the flip). */
function CardMenu({
  item,
  onRemove,
  removing,
  open,
  onOpenChange: setOpen,
}: {
  item: PlanningListItem;
  onRemove: (item: PlanningListItem) => void;
  removing: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const rootRef = useRef<HTMLSpanElement>(null);
  // An outside press closes it. A document listener, not a fixed
  // full-screen click-catcher: the card is now a 3D context, which would
  // anchor a `position: fixed` catcher to the card instead of the viewport.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node && rootRef.current?.contains(e.target))) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, setOpen]);
  return (
    <span ref={rootRef} className="relative inline-block shrink-0">
      <Tooltip label="More actions">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-haspopup="true"
          aria-expanded={open}
          aria-label={`More actions for ${item.lead_business_name}`}
          className="rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg"
        >
          ⋯
        </button>
      </Tooltip>
      {open && (
        <>
          <div className="menu-panel absolute right-0 z-20 mt-1 w-44 rounded-md border border-border bg-surface py-1 shadow-lg">
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

/** Details/Back share one spot — the card's top-right corner — so flipping and flipping back is one repeated click. Solid (btn-secondary) so it stays legible over a screenshot; the hit area grows to 44px tall, inside the face. */
const TOGGLE = "btn btn-secondary btn-sm absolute right-2.5 top-2.5 z-10 shadow-sm after:absolute after:inset-x-0 after:-inset-y-2.5";

function FlipToggle({
  label,
  ariaLabel,
  toggleRef,
  onToggle,
}: {
  label: string;
  ariaLabel: string;
  toggleRef: RefObject<HTMLButtonElement | null>;
  onToggle: () => void;
}) {
  return (
    <button ref={toggleRef} type="button" onClick={onToggle} aria-label={ariaLabel} className={TOGGLE}>
      {label}
    </button>
  );
}

export function PlanningCard({
  item,
  checklist,
  density,
  onRemove,
  removing,
  flash,
}: {
  flash?: boolean;
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
  // Derived from data already on the page — nothing is fetched to flip.
  const back = planningCardBack(item, checklist);

  const flip = useCardFlip();
  const [menuOpen, setMenuOpenState] = useState(false);
  function setMenuOpen(open: boolean) {
    setMenuOpenState(open);
    flip.setMenuOpen(open);
  }

  // As on ClientCard: an explicit Details/Back makes the pressed toggle
  // inert, so focus moves to the other face's toggle rather than being
  // dropped on the page. Hover flips never move focus.
  const detailsRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const focusAfterFlip = useRef(false);
  const flipped = flip.face === "back";
  useEffect(() => {
    if (!focusAfterFlip.current) return;
    focusAfterFlip.current = false;
    (flipped ? backRef : detailsRef).current?.focus();
  }, [flipped]);

  // A filter, sort or "Load more" can move this card out from under a
  // resting pointer without any pointer event firing, which would leave
  // its hover timer running and flip a card nobody is pointing at. So
  // after any re-render while hovered, re-check the real :hover state —
  // once the grid's 200ms glide to the new position (useLayoutFlip on the
  // page) is over, since mid-glide the card can still be under the pointer.
  const rootRef = useRef<HTMLDivElement>(null);
  const { hovered, pointerLeft } = flip;
  useEffect(() => {
    if (!hovered) return;
    const id = setTimeout(() => {
      if (rootRef.current && !rootRef.current.matches(":hover")) pointerLeft();
    }, 250);
    return () => clearTimeout(id);
  });

  const frontExposure = faceExposure(!flipped, flip.moving);
  const backExposure = faceExposure(flipped, flip.moving);
  // Each face clips itself — clipping on the preserve-3d rotor would
  // flatten the 3D context (see ClientCard).
  const faceBase = "overflow-hidden rounded-md border border-border bg-surface backface-hidden hover:border-border-strong";

  return (
    // Static outer box: owns the grid cell and the pointer/focus handlers
    // and never moves. The front stays in normal flow, so its own content
    // still sizes the cell exactly as before; the back is laid over it at
    // the same size, so flipping never reflows the grid.
    <div
      ref={rootRef}
      data-flipped={flipped}
      className={`relative ${flip.moving ? "z-10" : ""}`}
      {...flip.pointerHandlers}
      {...flip.focusHandlers}
    >
      <div className="h-full perspective-distant">
        <div
          style={flip.reducedMotion ? undefined : { transitionDuration: `${FLIP_MS}ms` }}
          className={`relative h-full transform-3d ${flipped ? "rotate-y-180" : ""} ${
            flip.reducedMotion ? "" : "transition-transform ease-standard motion-reduce:transition-none"
          }`}
        >
          {/* Front */}
          <div
            role="group"
            aria-label={`${item.lead_business_name} — summary`}
            inert={frontExposure.inert}
            aria-hidden={frontExposure.ariaHidden || undefined}
            className={`card-interactive flex h-full flex-col ${faceBase} ${flash ? "row-flash" : ""} ${frontExposure.invisible ? "invisible" : ""}`}
          >
            <div className="relative">
              <Link href={href} tabIndex={-1} aria-hidden="true">
                <PlanningPreview item={item} />
              </Link>
              <FlipToggle
                label="Details"
                ariaLabel={`Show details for ${item.lead_business_name}`}
                toggleRef={detailsRef}
                onToggle={() => {
                  focusAfterFlip.current = true;
                  flip.showDetails();
                }}
              />
            </div>
            <div className={`flex flex-1 flex-col gap-1.5 ${padY}`}>
              <div className="flex items-start justify-between gap-1.5">
                <Link
                  href={href}
                  title={item.lead_business_name}
                  className="min-w-0 truncate font-medium text-fg hover:underline"
                >
                  {item.lead_business_name}
                </Link>
                <CardMenu item={item} onRemove={onRemove} removing={removing} open={menuOpen} onOpenChange={setMenuOpen} />
              </div>

              {locationParts.length > 0 && <p className="truncate text-xs text-fg-muted">{locationParts.join(" · ")}</p>}

              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={STATUS_BADGE_TONE[item.status]}>{PLANNING_STATUS_LABELS[item.status]}</Badge>
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

          {/* Back — deliberately minimal: who, which step, one next action, one way in. */}
          <div
            role="group"
            aria-label={`${item.lead_business_name} — next step`}
            inert={backExposure.inert}
            aria-hidden={backExposure.ariaHidden || undefined}
            className={`absolute inset-0 flex rotate-y-180 flex-col px-3 pb-3 pt-2.5 ${faceBase} ${backExposure.invisible ? "invisible" : ""}`}
          >
            <p className="truncate pr-16 text-xs font-medium leading-6 text-fg-muted" title={item.lead_business_name}>
              {item.lead_business_name}
            </p>
            <FlipToggle
              label="Back"
              ariaLabel={`Back to summary for ${item.lead_business_name}`}
              toggleRef={backRef}
              onToggle={() => {
                focusAfterFlip.current = true;
                flip.showFront();
              }}
            />
            {/* Scrolls only as a safety net, so unusually long copy is never clipped unreadably. */}
            <dl className="-mx-1 mt-3 min-h-0 flex-1 overflow-y-auto px-1">
              {back.stepLabel && (
                <>
                  <dt className="text-xs text-fg-muted">Current step</dt>
                  <dd className="mt-0.5 text-base font-semibold leading-snug text-fg">{back.stepLabel}</dd>
                </>
              )}
              <dt className={`text-xs text-fg-muted ${back.stepLabel ? "mt-4" : ""}`}>{back.attention ? "Needs attention" : "Next"}</dt>
              <dd className={`mt-0.5 text-sm leading-5 ${back.attention ? "font-medium text-red-700 dark:text-red-400" : "text-fg"}`}>
                {back.message}
              </dd>
            </dl>
            <div className="flex shrink-0 justify-end pt-2">
              {/* Named per plan (the visible text stays inside the name), since every card has one. */}
              <Link
                href={back.href}
                aria-label={`${back.cta.replace(" →", "")} — ${item.lead_business_name}`}
                className="btn btn-primary btn-sm relative shrink-0 after:absolute after:inset-x-0 after:-inset-y-2.5"
              >
                {back.cta}
              </Link>
            </div>
          </div>
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
