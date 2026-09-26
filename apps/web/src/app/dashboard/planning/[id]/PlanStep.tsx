"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Lead, Planning } from "@/lib/api";
import { useDismissableOverlay } from "@/lib/useDismissableOverlay";
import { ChevronDownIcon } from "@/components/ui/ControlIcons";
import { BuildBriefTab } from "./BuildBriefTab";
import { ContentDraftTab } from "./ContentDraftTab";
import { CurrentWebsiteDialog } from "./CurrentWebsiteDialog";
import { InspirationDrawer } from "./InspirationDrawer";
import { RecommendationsSection } from "./RecommendationsSection";
import { RequirementsBoard } from "./RequirementsBoard";
import { StepFooter } from "./StepFooter";
import { WebsiteBlueprintSection } from "./WebsiteBlueprintSection";
import { computePlanSelectionSummary, isSiteWideRecommendation } from "./websiteBlueprintLib";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

type LeadBusinessFields = Pick<Lead, "industry" | "suburb" | "state" | "business_phone" | "business_email">;

// The requirements board's height, on wide screens: real viewport
// height, minus a couple of small fixed constants this file fully
// controls (the dashboard's own sticky header strip, and two of this
// step's own layout gaps that don't show up in either measured box's own
// offsetHeight), minus three *measured* values — `--planning-above-h`
// (page.tsx: back-nav/header/notices/stepper — published only for this
// step, see that file) and `--plan-heading-h`/`--plan-below-h` (this
// step's own heading row — which also holds the "Site-wide improvements"
// trigger — and StepFooter, the only thing below the canvas; the
// site-wide panel and the "More" destinations are all `fixed` overlays,
// so they never take height from the canvas).
// Using real measurements for everything that can actually change size —
// a notice appearing, the header wrapping — is the point: a fixed offset
// chain would drift out of sync with any of those; this can't, because
// the browser recomputes this calc() itself whenever the custom
// properties it reads change, with no extra JS on this end. `max(240px,
// …)` is the floor for a short/narrow window — below it this stops
// shrinking and the *page* scrolls a little instead, which is the wanted
// fallback (never a crushed, unusable editor).
// Floor raised from 240px to 480px once the inspiration strip joined the
// board: on a ~680px-tall laptop viewport the old floor squeezed the canvas
// to ~70px. Below the floor the page scrolls a little instead.
const BOARD_HEIGHT_CSS =
  "max(480px, calc(100dvh - 2.75rem - 0.75rem - 1rem - 1.25rem - var(--planning-above-h, 0px) - var(--plan-heading-h, 0px) - var(--plan-below-h, 0px)))";

/**
 * Step 2 — "Choose your website" (step id "plan"). Merges the old "Choose improvements" and "Prepare the
 * website" steps so every recommendation is decided in exactly one place
 * (see websiteBlueprintLib.ts's "Plan step" comment):
 *
 * - Website features — the requirements board (RequirementsBoard.tsx) is
 *   the primary, always-visible editor: a flat, position-independent
 *   picker over `planning.blueprint_requirements`. Evidence-backed feature
 *   recommendations appear in its library's "Recommended" view, and
 *   adding one there IS accepting it (removing returns it to proposed).
 * - Everything else — strengths to keep and cross-page concerns like
 *   speed, accessibility or SEO — lives in a compact "Site-wide
 *   improvements" slide-over opened from the heading row (see
 *   `SiteWideImprovementsPanel`), with the same Accept/Dismiss/Edit/Remove
 *   and Generate/Regenerate controls `RecommendationsSection` has always
 *   had. A trigger + slide-over rather than an inline strip so it never
 *   competes with the canvas for the viewport-fit height above.
 * - Inspiration — shared reference sites for look and feel, attached from
 *   a slide-over library (`InspirationDrawer`, opened from the heading
 *   row or the board's thumbnail strip). Kept apart from features.
 *
 * The old page-by-page wireframe editor and Build Brief/Content Draft stay
 * reachable from the "More" menu (`PlanMoreMenu`). `BuildBriefTab` gets
 * `showRecommendations={false}`, since this step already shows that
 * Keep/Improve/Add editor (split between the library and the site-wide
 * panel).
 *
 * Unsaved edits: this step only *reports* whether either editor is dirty
 * (`onDirtyChange`); page.tsx owns the discard confirmation for every way
 * of leaving the step (stepper, Previous, Continue).
 */
export function PlanStep({
  planning,
  lead,
  onUpdated,
  onDirtyChange,
  onBriefApproved,
  onPrevious,
  onNext,
}: {
  planning: Planning;
  lead: LeadBusinessFields | null;
  onUpdated: (p: Planning) => void;
  onDirtyChange: (dirty: boolean) => void;
  /** Approving the Build Brief from the Reference overlay — lets page.tsx
   * refresh the checklist, same as approving it anywhere else. */
  onBriefApproved: () => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  // The requirements board's own "a notes edit is open and unsaved"
  // signal, and the old Blueprint editor's own inspector-dirty signal —
  // kept as two flags rather than one shared piece of state, since they
  // come from two independent editors that can each be mid-edit
  // independently of the other. Reported up as one boolean.
  const [requirementsDirty, setRequirementsDirty] = useState(false);
  const [blueprintDirty, setBlueprintDirty] = useState(false);
  const dirty = requirementsDirty || blueprintDirty;
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  // Leaving the step unmounts both editors (and their unsaved edits), so
  // the page's guard must stop treating the step as dirty.
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  // Whether each "More" menu destination is currently showing as its own
  // dismissible overlay. The old detailed-layout editor's overlay stays
  // mounted (just visually hidden via `hidden`, not conditionally
  // rendered) once opened, so opening/closing it never loses whatever
  // page/section is currently selected inside WebsiteBlueprintSection.
  // The Reference and site-wide overlays carry no unsaved local state
  // that matters across a close, so they mount only while open.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [siteWideOpen, setSiteWideOpen] = useState(false);
  const [inspirationOpen, setInspirationOpen] = useState(false);

  // Publishes this step's own two measured heights (see BOARD_HEIGHT_CSS's
  // comment) as CSS custom properties on `rootRef`, so the board wrapper
  // below — a descendant, however deep — can read them via `var()`. Same
  // ResizeObserver-to-custom-property approach as page.tsx's
  // `--planning-above-h`. Every overlay this step opens is `fixed`, so
  // none of them ever contributes to these measurements.
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLDivElement>(null);
  const belowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    const heading = headingRef.current;
    const below = belowRef.current;
    if (!root || !heading || !below) return;
    const publish = () => {
      root.style.setProperty("--plan-heading-h", `${heading.offsetHeight}px`);
      root.style.setProperty("--plan-below-h", `${below.offsetHeight}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(heading);
    observer.observe(below);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--plan-heading-h");
      root.style.removeProperty("--plan-below-h");
    };
  }, []);

  // The board only gets an explicit (calc'd) height at `lg` and up — below
  // that it's simply not set (`undefined`), so the board renders at its
  // natural content height and the page scrolls normally, exactly the
  // "let it grow on narrow/short screens" fallback. `isDesktop` only
  // changes on a breakpoint crossing, not on every resize, so this is the
  // one piece of plain React state involved — the height *value* itself
  // is a live CSS calc(), not recomputed here.
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return (
    <div ref={rootRef} className="content-reveal space-y-4">
      <section>
        <div ref={headingRef} className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-xl">
            <h2 className="section-title">Choose your website</h2>
            <p className="mt-1 text-sm text-fg-muted">Start from a template, then add or remove features.</p>
          </div>
          {/* Grouped together at the row's right edge — see page.tsx for
              why this row shares its right boundary with the stepper's
              "Notes" button above and the canvas below (the same
              unconstrained-width parent, not three independently
              hard-coded offsets). */}
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <InspirationTrigger planning={planning} open={inspirationOpen} onOpen={() => setInspirationOpen(true)} />
            <SiteWideTrigger planning={planning} open={siteWideOpen} onOpen={() => setSiteWideOpen(true)} />
            <PlanMoreMenu onOpenLayoutEditor={() => setAdvancedOpen(true)} onOpenReference={() => setReferenceOpen(true)} />
            {/* This step gives its canvas the width the persistent website
                preview column would otherwise take (see page.tsx) — this is
                that same screenshot content, on demand instead of at rest. */}
            <CurrentWebsiteDialog planning={planning} />
          </div>
        </div>
        {/* See BOARD_HEIGHT_CSS's own comment — this only gets an explicit
            height at `lg` and up; below that it's `undefined` (natural
            content height, page scrolls normally). */}
        <div className="mt-3" style={isDesktop ? { height: BOARD_HEIGHT_CSS } : undefined}>
          <RequirementsBoard
            planning={planning}
            lead={lead}
            onUpdated={onUpdated}
            onDirtyChange={setRequirementsDirty}
            onOpenRecommendations={() => setSiteWideOpen(true)}
            onOpenInspiration={() => setInspirationOpen(true)}
          />
        </div>
      </section>

      <div ref={belowRef}>
        {/* No discard confirm here — page.tsx's `requestStep` guards every
            way off this step using the `onDirtyChange` signal above. */}
        <StepFooter onPrevious={onPrevious} onNext={onNext} nextLabel="Continue to review" />
      </div>

      {siteWideOpen && (
        <SiteWideImprovementsPanel planning={planning} onUpdated={onUpdated} onClose={() => setSiteWideOpen(false)} />
      )}

      {inspirationOpen && (
        <InspirationDrawer planning={planning} onUpdated={onUpdated} onClose={() => setInspirationOpen(false)} />
      )}

      {/* Always mounted (never conditionally rendered) — only visually
          hidden via `hidden` when closed — specifically so
          WebsiteBlueprintSection's own internal page/section selection
          and dirty-tracking state survive closing and reopening this
          dialog. Being `fixed`, it never affects this step's own layout or
          the `--plan-below-h` measurement above regardless of state. */}
      <LayoutEditorOverlay
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        planning={planning}
        onUpdated={onUpdated}
        onDirtyChange={setBlueprintDirty}
      />

      {referenceOpen && (
        <ReferenceOverlay
          planning={planning}
          lead={lead}
          onUpdated={onUpdated}
          onBriefApproved={onBriefApproved}
          onClose={() => setReferenceOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * The heading-row entry point to "Site-wide improvements" — a regular
 * `control-btn` (same weight as "More" beside it, so it reads as
 * secondary to the canvas) carrying a small status pill: how many of the
 * site-wide recommendations are accepted, or that none have been
 * generated yet, so the operator can see at a glance whether anything
 * there still needs a decision without opening it.
 */
function SiteWideTrigger({ planning, open, onOpen }: { planning: Planning; open: boolean; onOpen: () => void }) {
  const summary = computePlanSelectionSummary(planning);
  const accepted = summary.siteWideAccepted.length;
  const total = accepted + summary.siteWideProposed;
  const notGenerated = planning.recommendations.length === 0;
  const status = notGenerated ? "Not generated" : total === 0 ? "None" : `${accepted} of ${total} accepted`;
  const pending = !notGenerated && summary.siteWideProposed > 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={`Site-wide improvements — ${status}${pending ? `, ${summary.siteWideProposed} awaiting a decision` : ""}`}
      className="control-btn"
    >
      Site-wide improvements
      <span
        aria-hidden="true"
        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
          pending ? "bg-pill-info-bg text-pill-info-fg" : "bg-surface text-fg-muted"
        }`}
      >
        {status}
      </span>
    </button>
  );
}

/**
 * Opens the Inspiration library. Same `control-btn` weight as its
 * neighbours; the count pill appears only once something is attached.
 */
function InspirationTrigger({ planning, open, onOpen }: { planning: Planning; open: boolean; onOpen: () => void }) {
  const count = planning.inspiration_references?.length ?? 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={count > 0 ? `Inspiration — ${count} attached` : "Inspiration — add reference sites"}
      className="control-btn"
    >
      Inspiration
      {count > 0 && (
        <span aria-hidden="true" className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-fg-muted">
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * "Site-wide improvements" — the recommendations that aren't a website
 * feature (`isSiteWideRecommendation`: "keep" strengths, and cross-page
 * concerns like speed, accessibility or SEO). The existing
 * `RecommendationsSection`, filtered — same Accept/Dismiss/Edit/Remove,
 * "+ Add" and Generate/Regenerate controls it has always had, not a fork.
 * A right-hand slide-over (the app's shared `.side-panel` pattern, same as
 * NotesPanel) so it stays one click away without taking height from the
 * canvas.
 */
function SiteWideImprovementsPanel({
  planning,
  onUpdated,
  onClose,
}: {
  planning: Planning;
  onUpdated: (p: Planning) => void;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { containerRef } = useDismissableOverlay({ open: true, onClose, initialFocusRef: closeButtonRef });
  const titleId = useId();

  return (
    <div className="side-panel-overlay" onClick={onClose} role="presentation">
      <div
        ref={containerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="side-panel side-panel--wide focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-fg">
              Site-wide improvements
            </h2>
            <p className="mt-1 text-xs text-fg-muted">
              Strengths to keep and improvements that apply across the whole site, like speed, accessibility and
              SEO. Website features are chosen in the feature library instead.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close site-wide improvements"
            className="shrink-0 rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
              <path d="M4.22 4.22a.75.75 0 0 1 1.06 0L10 8.94l4.72-4.72a.75.75 0 1 1 1.06 1.06L11.06 10l4.72 4.72a.75.75 0 1 1-1.06 1.06L10 11.06l-4.72 4.72a.75.75 0 0 1-1.06-1.06L8.94 10 4.22 5.28a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <RecommendationsSection
            planning={planning}
            onUpdated={onUpdated}
            filter={isSiteWideRecommendation}
            generateHint="Generating adds new recommendations — existing ones and your decisions are kept. New feature ideas appear in the library."
          />
        </div>
      </div>
    </div>
  );
}

/**
 * The compact "More" menu beside the heading — a non-modal popover
 * holding the two things that used to be large, always-present
 * accordions beneath the canvas: the detailed page-layout editor and the
 * Build Brief/Content Draft reference. Each item opens its own
 * dismissible overlay (see LayoutEditorOverlay/ReferenceOverlay below)
 * rather than expanding inline, so neither one competes with the canvas
 * for space in the page's normal flow any more.
 *
 * Same open/outside-click/Escape/focus interaction pattern as
 * WebsiteBlueprintSection's own `BlueprintMoreMenu` (itself adapted from
 * FilterPopover.tsx) — reproduced locally here rather than imported,
 * since that component isn't exported and its content is specific to
 * template switching; this keeps the one interaction pattern this app
 * uses for a "More" popover, without exporting a component whose menu
 * items would otherwise need generalising for a second, unrelated use.
 */
function PlanMoreMenu({
  onOpenLayoutEditor,
  onOpenReference,
}: {
  onOpenLayoutEditor: () => void;
  onOpenReference: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panelRef.current)?.focus({ preventScroll: true });

    function handlePointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative shrink-0"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
      onBlur={(e) => {
        if (open && e.relatedTarget instanceof Node && !rootRef.current?.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className="control-btn"
      >
        More
        <ChevronDownIcon
          aria-hidden="true"
          className={`h-3.5 w-3.5 transition-transform duration-fast ease-standard motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label="More options"
          tabIndex={-1}
          className="animate-rise-in absolute right-0 top-full z-30 mt-2 w-72 rounded-xl border border-border bg-surface p-1.5 shadow-xl outline-none"
        >
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onOpenLayoutEditor();
            }}
            className="block w-full rounded-md px-3 py-2 text-left transition-colors duration-fast ease-standard hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring motion-reduce:transition-none"
          >
            <span className="text-sm font-medium text-fg">Edit detailed page layout</span>
            <span className="mt-0.5 block text-xs text-fg-muted">Advanced — pages, ordered sections, drag-to-reorder</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onOpenReference();
            }}
            className="mt-0.5 block w-full rounded-md px-3 py-2 text-left transition-colors duration-fast ease-standard hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring motion-reduce:transition-none"
          >
            <span className="text-sm font-medium text-fg">Reference</span>
            <span className="mt-0.5 block text-xs text-fg-muted">Build Brief and Content Draft</span>
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The old page-by-page wireframe editor's new home — a large dialog
 * instead of an inline accordion, so it no longer sits in this step's
 * normal flow. `open` only controls the `hidden` attribute here, never
 * whether this returns the overlay at all: WebsiteBlueprintSection stays
 * mounted the entire time this step is, exactly as the old inline
 * `hidden` div kept it mounted across a collapse/reopen.
 */
function LayoutEditorOverlay({
  open,
  onClose,
  planning,
  onUpdated,
  onDirtyChange,
}: {
  open: boolean;
  onClose: () => void;
  planning: Planning;
  onUpdated: (p: Planning) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { containerRef } = useDismissableOverlay({ open, onClose, initialFocusRef: closeButtonRef });

  return (
    <div
      hidden={!open}
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={containerRef}
        tabIndex={-1}
        className="flex max-h-[calc(100dvh-2rem)] w-[min(96vw,1400px)] flex-col rounded-lg border border-border bg-surface shadow-xl focus:outline-none"
        role="dialog"
        aria-modal="true"
        aria-label="Detailed page layout editor"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-fg">Detailed page layout</p>
            <p className="truncate text-xs text-fg-muted">Advanced — pages, ordered sections, drag-to-reorder</p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} className="btn btn-secondary btn-sm shrink-0">
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <WebsiteBlueprintSection planning={planning} onUpdated={onUpdated} onDirtyChange={onDirtyChange} />
        </div>
      </div>
    </div>
  );
}

/**
 * Build Brief and Content Draft's new home — the same content the old
 * "Reference" Disclosure held, now a dialog. Unlike LayoutEditorOverlay
 * this mounts only while open (see the `advancedOpen`/`referenceOpen`
 * comment above for why that's fine here), the same
 * mount-while-open convention CurrentWebsiteDialog.tsx already uses.
 */
function ReferenceOverlay({
  planning,
  lead,
  onUpdated,
  onBriefApproved,
  onClose,
}: {
  planning: Planning;
  lead: LeadBusinessFields | null;
  onUpdated: (p: Planning) => void;
  onBriefApproved: () => void;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { containerRef } = useDismissableOverlay({ open: true, onClose, initialFocusRef: closeButtonRef });

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        ref={containerRef}
        tabIndex={-1}
        className="modal-panel flex max-h-[calc(100dvh-2rem)] w-[min(96vw,720px)] max-w-none flex-col p-0 focus:outline-none"
        role="dialog"
        aria-modal="true"
        aria-label="Reference — Build Brief and Content Draft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <p className="text-sm font-medium text-fg">Reference — Build Brief and Content Draft</p>
          <button ref={closeButtonRef} type="button" onClick={onClose} className="btn btn-secondary btn-sm shrink-0">
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-6 overflow-auto p-4">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Build Brief</h3>
            <div className="mt-2">
              <BuildBriefTab
                planning={planning}
                lead={lead}
                onUpdated={onUpdated}
                showRecommendations={false}
                onApproved={onBriefApproved}
              />
            </div>
          </div>
          <div className="border-t border-border pt-6">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Content Draft</h3>
            <div className="mt-2">
              <ContentDraftTab planning={planning} onUpdated={onUpdated} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
