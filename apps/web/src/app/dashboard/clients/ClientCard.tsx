"use client";

import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { AttentionCard } from "@/lib/clients";
import { ClientStatusBadge } from "@/components/ClientStatusBadge";
import type { EnrichedClient } from "./ClientRowFields";
import { ThumbnailPlaceholder } from "@/components/ui/ThumbnailPlaceholder";
import { clientCardBack, topAttentionItem } from "./clientCardSummary";
import { faceExposure, FLIP_MS, nextMenuIndex } from "./cardFlip";
import { useCardFlip } from "./useCardFlip";
import { Tooltip } from "@/components/ui/Tooltip";

/**
 * The card's preview area — the same 16:10 slot Planning/Project cards
 * open with. The Overview's list payload carries no screenshot of a
 * client's own website (Client, Project and Business have no screenshot
 * or thumbnail field, and nothing is fetched per card), so this is
 * always the shared placeholder ProjectCard uses, never a fabricated
 * image. The card keeps its fixed height, so the slot stops growing at
 * 10.5rem on wider cards to leave the body its room.
 */
function ClientPreview() {
  return <ThumbnailPlaceholder label="No preview yet" className="max-h-[10.5rem] shrink-0" />;
}

/** Icon-button shape shared with components/review/RowMenu's trigger: a 32px ghost button with the app's focus ring. */
const ICON_BUTTON = "btn btn-ghost h-8 w-8 !p-0";

/** Focus ring for plain text links inside a card face — the same ring colour as .btn. */
const LINK_FOCUS = "rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring";

/** Footer buttons keep btn-sm, but their hit area grows into the footer's own vertical padding (~42px tall) — nothing overlaps. */
const FOOTER_HIT = "relative after:absolute after:inset-x-0 after:-inset-y-2";

/** Eye icon — the explicit, always-visible quick-preview trigger, distinct from the "⋯" menu (which navigates away; this opens a panel without leaving the grid). */
function PreviewButton({ row, onOpen }: { row: EnrichedClient; onOpen: () => void }) {
  return (
    <Tooltip label="Quick preview">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onOpen();
        }}
        aria-label={`Quick preview of ${row.client.business_name}`}
        className={ICON_BUTTON}
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4" aria-hidden="true">
          <path d="M2.5 10S5.5 4.5 10 4.5 17.5 10 17.5 10 14.5 15.5 10 15.5 2.5 10 2.5 10Z" />
          <circle cx="10" cy="10" r="2" />
        </svg>
      </button>
    </Tooltip>
  );
}

const MENU_GAP = 4;

/** Compact "⋯" secondary-actions menu — every existing shortcut into
 * this client's own record (Open Client, Billing, Edit details), same
 * items RowActionsMenu already offered from the table. No Archive here:
 * Client has no archive concept anywhere in this codebase. Controlled
 * by the card, which must know it's open (an open menu blocks the flip). */
function CardMenu({ row, open, onOpenChange }: { row: EnrichedClient; open: boolean; onOpenChange: (open: boolean) => void }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const label = `More actions for ${row.client.business_name}`;
  return (
    <>
      <Tooltip label="More actions">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => onOpenChange(!open)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          aria-label={label}
          className={ICON_BUTTON}
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
            <circle cx="3" cy="8" r="1.4" />
            <circle cx="8" cy="8" r="1.4" />
            <circle cx="13" cy="8" r="1.4" />
          </svg>
        </button>
      </Tooltip>
      {open && (
        <CardMenuPanel
          id={menuId}
          label={label}
          clientId={row.client.id}
          triggerRef={triggerRef}
          onClose={(refocus) => {
            onOpenChange(false);
            if (refocus) triggerRef.current?.focus();
          }}
        />
      )}
    </>
  );
}

/**
 * Portalled to <body> and fixed-positioned from the trigger (the same
 * approach as RequirementCard's popover): each card face clips its own
 * content, and the turning card is a transformed element — which would
 * also re-anchor any `position: fixed` inside it (the old full-screen
 * click-catcher included) to the card instead of the viewport. Outside
 * pointer-down, an outside scroll or a resize closes it.
 *
 * Keyboard/AT semantics are components/review/RowMenu's: role="menu"
 * of menuitems, focus moves to the first item on open, ArrowUp/Down
 * wrap, Escape closes and returns focus to the trigger. Tab also closes
 * and returns to the trigger — being portalled, the next tab stop after
 * the menu would otherwise be the end of the document.
 */
function CardMenuPanel({
  id,
  label,
  clientId,
  triggerRef,
  onClose,
}: {
  id: string;
  label: string;
  clientId: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: (refocusTrigger: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const items = () => Array.from(containerRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  useLayoutEffect(() => {
    const panel = containerRef.current;
    const trigger = triggerRef.current;
    if (!panel || !trigger) return;
    const anchor = trigger.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = panel;
    const left = Math.max(MENU_GAP, Math.min(anchor.right - width, window.innerWidth - width - MENU_GAP));
    const below = anchor.bottom + MENU_GAP;
    const top = below + height > window.innerHeight - MENU_GAP ? Math.max(MENU_GAP, anchor.top - height - MENU_GAP) : below;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.visibility = "visible";
    panel.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [containerRef, triggerRef]);

  useEffect(() => {
    const isInside = (target: EventTarget | null) =>
      target instanceof Node && (containerRef.current?.contains(target) || triggerRef.current?.contains(target));
    const onPointerDown = (e: PointerEvent) => {
      if (!isInside(e.target)) onClose(false);
    };
    const onScroll = (e: Event) => {
      if (!(e.target instanceof Node && containerRef.current?.contains(e.target))) onClose(false);
    };
    const onResize = () => onClose(false);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [containerRef, triggerRef, onClose]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      onClose(true);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const els = items();
    els[nextMenuIndex(els.indexOf(document.activeElement as HTMLElement), els.length, e.key)]?.focus();
  }

  const item =
    "block w-full px-3 py-2 text-left text-sm text-fg hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none";
  return createPortal(
    <div
      ref={containerRef}
      id={id}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={{ visibility: "hidden" }}
      className="menu-panel fixed left-0 top-0 z-50 w-44 rounded-md border border-border bg-surface py-1 shadow-lg"
    >
      <Link role="menuitem" href={`/dashboard/clients/${clientId}`} onClick={() => onClose(false)} className={item}>
        Open Client
      </Link>
      <Link role="menuitem" href={`/dashboard/clients/${clientId}?tab=billing`} onClick={() => onClose(false)} className={item}>
        Billing
      </Link>
      <Link role="menuitem" href={`/dashboard/clients/${clientId}?tab=details`} onClick={() => onClose(false)} className={item}>
        Edit details
      </Link>
    </div>,
    document.body,
  );
}

/** The back face's footer. Its Back toggle and CTA sit exactly where the front's Details and Open Client do, so flipping and flipping back is one repeated click. */
function CardFooter({
  href,
  clientName,
  toggleLabel,
  toggleAriaLabel,
  toggleRef,
  onToggle,
  ctaLabel = "Open Client →",
  ctaClass = "btn-secondary",
}: {
  href: string;
  clientName: string;
  toggleLabel: string;
  toggleAriaLabel: string;
  toggleRef: RefObject<HTMLButtonElement | null>;
  onToggle: () => void;
  /** The back face uses the Planning/Project back's sentence-case primary CTA; the front keeps its own. */
  ctaLabel?: string;
  ctaClass?: string;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-3 py-2">
      <button ref={toggleRef} type="button" onClick={onToggle} aria-label={toggleAriaLabel} className={`btn btn-ghost btn-sm ${FOOTER_HIT}`}>
        {toggleLabel}
      </button>
      {/* Named per client (the visible label stays inside the name), since every card has one. */}
      <Link href={href} aria-label={`${ctaLabel.replace(" →", "")} — ${clientName}`} className={`btn ${ctaClass} btn-sm shrink-0 ${FOOTER_HIT}`}>
        {ctaLabel}
      </Link>
    </div>
  );
}

export function ClientCard({
  row,
  currency,
  attention,
  isPreviewOpen,
  onOpenPreview,
}: {
  row: EnrichedClient;
  currency: string;
  /** This client's entry from buildAttentionCards (overdue payments + required-tasks-outstanding) — the same grouping that drives the "Needs attention" view; null when the client needs no attention. */
  attention: AttentionCard | null;
  isPreviewOpen: boolean;
  onOpenPreview: () => void;
}) {
  const { client, tone } = row;
  const href = `/dashboard/clients/${client.id}`;
  const urgent = topAttentionItem(attention, currency);
  // Derived from data the Overview already holds for every row — nothing is fetched to flip.
  const back = clientCardBack(row, attention, currency);
  const flip = useCardFlip();
  const [menuOpen, setMenuOpenState] = useState(false);
  function setMenuOpen(open: boolean) {
    setMenuOpenState(open);
    flip.setMenuOpen(open);
  }

  // An explicit Details/Back makes the pressed toggle inert, so focus is
  // handed to the other face's toggle rather than dropped on the page.
  // Hover flips never move focus.
  const detailsRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const focusAfterFlip = useRef(false);
  const flipped = flip.face === "back";
  useEffect(() => {
    if (!focusAfterFlip.current) return;
    focusAfterFlip.current = false;
    (flipped ? backRef : detailsRef).current?.focus();
  }, [flipped]);

  // Each face clips itself (rounded + overflow-hidden) — clipping on the
  // preserve-3d rotor would flatten the 3D context, and Safari drops
  // backface-visibility under an overflow-clipped 3D parent. The hidden
  // face is inert at once, but stays painted until the turn finishes.
  const face = (isShown: boolean) =>
    `absolute inset-0 flex flex-col overflow-hidden rounded-md border bg-surface backface-hidden transition-[border-color,box-shadow] duration-fast ease-standard motion-reduce:transition-none ${
      isPreviewOpen ? "border-accent" : flip.hovered ? "border-border-strong shadow-md" : "border-border"
    } ${faceExposure(isShown, flip.moving).invisible ? "invisible" : ""}`;
  const frontExposure = faceExposure(!flipped, flip.moving);
  const backExposure = faceExposure(flipped, flip.moving);

  return (
    // Static outer box: owns the grid cell and the pointer/focus
    // handlers, and never moves — so the hit area is stable while the
    // inner layer lifts, and the grid never reflows.
    <div
      data-flipped={flipped}
      className={`relative h-[20rem] ${flip.lifted || flip.moving ? "z-10" : ""}`}
      {...flip.pointerHandlers}
      {...flip.focusHandlers}
    >
      <div
        className={`absolute inset-0 perspective-distant ${
          flip.reducedMotion ? "" : "transition-transform duration-base ease-standard motion-reduce:transition-none"
        } ${flip.lifted ? "-translate-y-0.5" : ""}`}
      >
        <div
          style={flip.reducedMotion ? undefined : { transitionDuration: `${FLIP_MS}ms` }}
          className={`absolute inset-0 transform-3d ${flipped ? "rotate-y-180" : ""} ${
            flip.reducedMotion ? "" : "transition-transform ease-standard motion-reduce:transition-none"
          }`}
        >
          {/* Front */}
          <div
            role="group"
            aria-label={`${client.business_name} — summary`}
            inert={frontExposure.inert}
            aria-hidden={frontExposure.ariaHidden || undefined}
            className={face(!flipped)}
          >
            {/* Same build as the Planning/Project fronts: preview, then name + actions, one status
                badge, at most one attention line. The Details toggle stays in the footer (not over
                the preview) so it shares its spot with the back face's Back. */}
            <Link href={href} tabIndex={-1} aria-hidden="true" className="block shrink-0">
              <ClientPreview />
            </Link>
            <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-3 pb-2 pt-3">
              <div className="flex items-start justify-between gap-1.5">
                <Link href={href} title={client.business_name} className={`min-w-0 truncate font-medium text-fg hover:underline ${LINK_FOCUS}`}>
                  {client.business_name}
                </Link>
                <span className="flex shrink-0 items-center gap-0.5">
                  <PreviewButton row={row} onOpen={onOpenPreview} />
                  <CardMenu row={row} open={menuOpen} onOpenChange={setMenuOpen} />
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <ClientStatusBadge tone={tone} />
              </div>

              {/* One line, the highest-priority issue only (see topAttentionItem) — icon and words,
                  never colour alone. Amounts and the rest stay on the back and the client page. */}
              {urgent && (
                <Link
                  href={urgent.href}
                  title={urgent.headline}
                  className={`flex min-w-0 items-center gap-1 text-xs font-medium text-red-700 hover:underline dark:text-red-400 ${LINK_FOCUS}`}
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 shrink-0" aria-hidden="true">
                    <path
                      fillRule="evenodd"
                      d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="min-w-0 truncate">{urgent.headline}</span>
                </Link>
              )}

              <div className="mt-auto flex shrink-0 items-center justify-between gap-2 pt-2">
                <button
                  ref={detailsRef}
                  type="button"
                  onClick={() => {
                    focusAfterFlip.current = true;
                    flip.showDetails();
                  }}
                  aria-label={`Show details for ${client.business_name}`}
                  className={`btn btn-ghost btn-sm ${FOOTER_HIT}`}
                >
                  Details
                </button>
                {/* Named per client (the visible label stays inside the name), since every card has one. */}
                <Link href={href} aria-label={`Open Client — ${client.business_name}`} className={`btn btn-secondary btn-sm shrink-0 ${FOOTER_HIT}`}>
                  Open Client →
                </Link>
              </div>
            </div>
          </div>

          {/* Back */}
          <div
            role="group"
            aria-label={`${client.business_name} — details`}
            inert={backExposure.inert}
            aria-hidden={backExposure.ariaHidden || undefined}
            className={`${face(flipped)} rotate-y-180`}
          >
            {/* Deliberately minimal, like the Planning/Project backs: who, where they stand, one next
                action. Contact, payment, hosting and task detail live on the client page. */}
            <div className="flex min-h-0 flex-1 flex-col p-3">
              <p className="line-clamp-2 break-words text-xs font-medium leading-5 text-fg-muted" title={client.business_name}>
                {client.business_name}
              </p>
              {/* Scrolls only as a safety net, so unusually long copy is never clipped unreadably. */}
              <dl className="-mx-1 mt-3 min-h-0 flex-1 overflow-y-auto px-1">
                <dt className="text-xs text-fg-muted">Status</dt>
                <dd className="mt-0.5 text-base font-semibold leading-snug text-fg">{back.statusLabel}</dd>
                <dd className="mt-0.5 line-clamp-2 break-words text-xs leading-5 text-fg-muted" title={back.projectSummary}>
                  {back.projectSummary}
                </dd>
                <dt className="mt-4 text-xs text-fg-muted">{back.attention ? "Needs attention" : "Next"}</dt>
                <dd
                  className={`mt-0.5 break-words text-sm leading-5 ${
                    back.attention ? "font-medium text-red-700 dark:text-red-400" : "text-fg-muted"
                  }`}
                >
                  {back.message}
                </dd>
              </dl>
            </div>
            <CardFooter
              href={href}
              clientName={client.business_name}
              toggleLabel="Back"
              toggleAriaLabel={`Back to summary for ${client.business_name}`}
              toggleRef={backRef}
              ctaLabel="Open client →"
              ctaClass="btn-primary"
              onToggle={() => {
                focusAfterFlip.current = true;
                flip.showFront();
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Skeleton matching ClientCard's front face — same fixed height — so
 * the swap to real cards is a content change, not a layout jump. */
export function ClientCardSkeleton() {
  return (
    <div className="flex h-[20rem] flex-col overflow-hidden rounded-md border border-border bg-surface">
      <div className="skeleton aspect-[16/10] max-h-[10.5rem] w-full shrink-0 rounded-none" />
      <div className="flex flex-1 flex-col gap-2 px-3 pb-2 pt-3">
        <div className="skeleton h-4 w-2/3" />
        <div className="skeleton h-4 w-20" />
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <div className="skeleton h-6 w-16" />
          <div className="skeleton h-6 w-24" />
        </div>
      </div>
    </div>
  );
}
