"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Lead, Planning } from "@/lib/api";
import { useConfirm } from "@/components/ui/ConfirmProvider";
import { useDismissableOverlay } from "@/lib/useDismissableOverlay";
import { ChevronDownIcon } from "@/components/ui/ControlIcons";
import { BuildBriefTab } from "./BuildBriefTab";
import { ContentDraftTab } from "./ContentDraftTab";
import { CurrentWebsiteDialog } from "./CurrentWebsiteDialog";
import { RequirementsBoard } from "./RequirementsBoard";
import { StepFooter } from "./StepFooter";
import { WebsiteBlueprintSection } from "./WebsiteBlueprintSection";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

type LeadBusinessFields = Pick<Lead, "industry" | "suburb" | "state" | "business_phone" | "business_email">;

// The Website Blueprint editor's height, on wide screens: real viewport
// height, minus a couple of small fixed constants this file fully
// controls (the dashboard's own sticky header strip, and two of this
// step's own layout gaps that don't show up in either measured box's own
// offsetHeight), minus three *measured* values — `--planning-above-h`
// (page.tsx: back-nav/header/notices/stepper — published only for this
// step, see that file) and `--prepare-heading-h`/`--prepare-below-h`
// (this step's own heading row, and StepFooter — the only thing left
// below the canvas now that the old-editor toggle and the Reference
// disclosure have both moved into the "More" menu, see below).
// Using real measurements for everything that can actually change size —
// a notice appearing, the header wrapping — is the point: a fixed offset
// chain would drift out of sync with any of those; this can't, because
// the browser recomputes this calc() itself whenever the custom
// properties it reads change, with no extra JS on this end. `max(240px,
// …)` is the floor for a short/narrow window — below it this stops
// shrinking and the *page* scrolls a little instead, which is the wanted
// fallback (never a crushed, unusable editor).
const BOARD_HEIGHT_CSS =
  "max(240px, calc(100dvh - 2.75rem - 0.75rem - 1rem - 1.25rem - var(--planning-above-h, 0px) - var(--prepare-heading-h, 0px) - var(--prepare-below-h, 0px)))";

/**
 * Step 4 — "Prepare the website". The requirements board (see
 * RequirementsBoard.tsx) is the primary, always-visible editor here — a
 * flat, position-independent picker over `planning.blueprint_requirements`,
 * a genuinely separate concept from the old page-by-page wireframe editor
 * (see the Requirement type's own comment in lib/api.ts). That old editor
 * — pages, ordered sections, drag-to-reorder — is never removed: it's
 * reachable from a compact "More" menu beside the heading (see
 * `PrepareMoreMenu` below) instead of sitting in the page's normal flow,
 * so it stays available for whichever plans already have a template
 * applied to them from a prior session, without competing with the board
 * as the main thing on this step or eating into the canvas's own height.
 * Build Brief and Content Draft are the same full editors they've always
 * been — nothing about their own generation/editing/saving/approval
 * behaviour changes — just reachable behind that same menu's "Reference"
 * item. `BuildBriefTab` still gets `showRecommendations={false}`, since
 * "Choose improvements" (Step 3) already shows that same Keep/Improve/Add
 * editor.
 */
export function PrepareStep({
  planning,
  lead,
  onUpdated,
  onPrevious,
  onNext,
}: {
  planning: Planning;
  lead: LeadBusinessFields | null;
  onUpdated: (p: Planning) => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const confirm = useConfirm();
  // The requirements board's own "a notes edit is open and unsaved"
  // signal, and the old Blueprint editor's own inspector-dirty signal —
  // kept as two flags rather than one shared piece of state, since they
  // come from two independent editors that can each be mid-edit
  // independently of the other. "Continue to review" guards on either
  // being true before leaving the step, so neither kind of unsaved edit
  // is ever silently discarded just by clicking through.
  const [requirementsDirty, setRequirementsDirty] = useState(false);
  const [blueprintDirty, setBlueprintDirty] = useState(false);
  // Whether each "More" menu destination is currently showing as its own
  // dismissible overlay. The old detailed-layout editor's overlay stays
  // mounted (just visually hidden via `hidden`, not conditionally
  // rendered) once opened — same convention this step already used for
  // it before it moved into a dialog — so opening/closing it never loses
  // whatever page/section is currently selected inside
  // WebsiteBlueprintSection. The Reference overlay has no such
  // requirement (Build Brief/Content Draft carry no unsaved local state
  // of their own — see BuildBriefTab/ContentDraftTab), so it mounts only
  // while open, the same as it did inside the old Disclosure.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);

  // Publishes this step's own two measured heights (see BOARD_HEIGHT_CSS's
  // comment) as CSS custom properties on `rootRef`, so the board wrapper
  // below — a descendant, however deep — can read them via `var()`. Same
  // ResizeObserver-to-custom-property approach as page.tsx's
  // `--planning-above-h`. `belowRef` now wraps only StepFooter — the old
  // Advanced-toggle/Reference block it used to also measure is gone from
  // the page's normal flow (both overlays below are `fixed`, so they
  // never contribute to this measurement regardless of open/closed
  // state), which is exactly what lets the canvas claim that freed space
  // through the live recalculation, with no other change needed here.
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLDivElement>(null);
  const belowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    const heading = headingRef.current;
    const below = belowRef.current;
    if (!root || !heading || !below) return;
    const publish = () => {
      root.style.setProperty("--prepare-heading-h", `${heading.offsetHeight}px`);
      root.style.setProperty("--prepare-below-h", `${below.offsetHeight}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(heading);
    observer.observe(below);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--prepare-heading-h");
      root.style.removeProperty("--prepare-below-h");
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

  async function handleNext() {
    if (requirementsDirty || blueprintDirty) {
      const ok = await confirm({
        title: "Discard unsaved changes?",
        description:
          "This step has edits that haven't been saved yet — " +
          (requirementsDirty && blueprintDirty
            ? "a feature's notes and a Blueprint section."
            : requirementsDirty
              ? "a feature's notes."
              : "a Blueprint section.") +
          " Continuing to Review & hand off will discard them.",
        confirmLabel: "Discard changes",
        danger: true,
      });
      if (!ok) return;
    }
    onNext();
  }

  return (
    <div ref={rootRef} className="content-reveal space-y-4">
      <section>
        <div ref={headingRef} className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="section-title">What should this website include?</h2>
            <p className="mt-1 text-sm text-fg-muted">Add the features and content you want included in the website plan.</p>
          </div>
          {/* Grouped together at the row's right edge — see page.tsx for
              why this row shares its right boundary with the stepper's
              "Notes" button above and the canvas below (the same
              unconstrained-width parent, not three independently
              hard-coded offsets). */}
          <div className="flex shrink-0 items-center gap-2">
            <PrepareMoreMenu onOpenLayoutEditor={() => setAdvancedOpen(true)} onOpenReference={() => setReferenceOpen(true)} />
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
          <RequirementsBoard planning={planning} onUpdated={onUpdated} onDirtyChange={setRequirementsDirty} />
        </div>
      </section>

      <div ref={belowRef}>
        <StepFooter onPrevious={onPrevious} onNext={handleNext} nextLabel="Continue to review" />
      </div>

      {/* Always mounted (never conditionally rendered) — only visually
          hidden via `hidden` when closed — specifically so
          WebsiteBlueprintSection's own internal page/section selection
          and dirty-tracking state survive closing and reopening this
          dialog, the same guarantee the old inline `hidden` toggle gave
          it. Being `fixed`, it never affects this step's own layout or
          the `--prepare-below-h` measurement above regardless of state. */}
      <LayoutEditorOverlay
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        planning={planning}
        onUpdated={onUpdated}
        onDirtyChange={setBlueprintDirty}
      />

      {referenceOpen && (
        <ReferenceOverlay planning={planning} lead={lead} onUpdated={onUpdated} onClose={() => setReferenceOpen(false)} />
      )}
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
function PrepareMoreMenu({
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
  onClose,
}: {
  planning: Planning;
  lead: LeadBusinessFields | null;
  onUpdated: (p: Planning) => void;
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
              <BuildBriefTab planning={planning} lead={lead} onUpdated={onUpdated} showRecommendations={false} />
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
