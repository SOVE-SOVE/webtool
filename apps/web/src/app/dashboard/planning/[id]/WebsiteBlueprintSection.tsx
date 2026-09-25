"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api, ApiError, BLUEPRINT_TEMPLATES, type BlueprintTemplate, type Planning } from "@/lib/api";
import { useConfirm } from "@/components/ui/ConfirmProvider";
import { SaveStatus, type SaveStatusValue } from "@/components/ui/SaveStatus";
import { ChevronDownIcon } from "@/components/ui/ControlIcons";
import { BLUEPRINT_TEMPLATE_LABEL, BLUEPRINT_TEMPLATE_PREVIEWS, findContentPage, SECTION_TYPE_LABEL } from "./websiteBlueprintLib";
import { BlueprintLibraryPanel } from "./BlueprintLibraryPanel";
import { BlueprintCanvas } from "./BlueprintCanvas";
import { BlueprintInspector } from "./BlueprintInspector";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

/**
 * "Website Blueprint" — a visual, wireframe-style editor over the SAME
 * hierarchy Content Draft and the Build Brief's sitemap proposal
 * already manage: `sitemap_pages` -> `content_pages` -> `sections`.
 * It never introduces a parallel data model — applying a template,
 * adding/removing/reordering a section, and editing a section's light
 * heading/purpose/draft_text/notes fields all go through the exact
 * same Planning-scoped endpoints those other editors use, so a change
 * made here shows up there too (and vice versa) with no second fetch:
 * every mutation returns the full updated `Planning` and feeds it
 * straight into `onUpdated`.
 *
 * Header/footer are rendered as fixed, non-editable chrome around every
 * page's canvas (see BlueprintCanvas) — they are never stored
 * `sections`, because the real site generator derives them from
 * site-wide nav config, not per-page content.
 *
 * Once a layout exists, the editor is a minimal toolbar (page tabs, a
 * save-status readout for whichever section is open, and one "More"
 * menu for template switching) over a two-column canvas: a permanent
 * section-library column on the left and the browser-style page canvas
 * filling the rest — the inspector only joins as a third column while a
 * section is actually selected. There is no undo/redo control here:
 * this editor has never had an undo/redo system (the only prior "undo"
 * reference anywhere in this editor was the word "undone" in unrelated
 * confirm-dialog copy), so one isn't invented for this toolbar.
 */
export function WebsiteBlueprintSection({
  planning,
  onUpdated,
  onDirtyChange,
}: {
  planning: Planning;
  onUpdated: (p: Planning) => void;
  /** Reports whether the inspector currently has edits that haven't
   * been saved — the same signal that gates this component's own
   * internal navigation guard (`confirmDiscardIfDirty`), lifted so a
   * caller like PrepareStep's "Continue to review" footer can apply the
   * same guard before leaving the step entirely. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const confirm = useConfirm();
  const pages = useMemo(() => [...planning.sitemap_pages].sort((a, b) => a.order_index - b.order_index), [planning.sitemap_pages]);
  const hasLayout = pages.length > 0;

  const [applyingTemplate, setApplyingTemplate] = useState<BlueprintTemplate | null>(null);
  const [startingBlank, setStartingBlank] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const pickerBusy = applyingTemplate !== null || startingBlank;

  // Collapsed by default below the `@3xl` container-query threshold
  // (see the grid below) — that's the same width the canvas/library/
  // inspector split already collapses to a single stacked column at, so
  // this reuses that existing boundary rather than inventing a new one.
  // At `@3xl` and above the library is always visible regardless of
  // this flag (a permanent column, not a drawer); below it, the canvas
  // — the main thing — gets priority and the library sits behind a
  // toggle instead of pushing the canvas down the page.
  const [libraryOpenNarrow, setLibraryOpenNarrow] = useState(false);

  // The operator's last explicit page/section click, if any — not the
  // source of truth on its own. Deriving `activePage`/`selectedSection`
  // below (rather than syncing these back with a `useEffect` whenever
  // the underlying pages/sections change) means a stale id left over
  // from before a template swap, a page removed elsewhere, or a section
  // that's just been deleted simply stops resolving to anything on the
  // very next render — no separate reset effect needed, and nothing
  // ever points at a row that no longer exists.
  const [clickedPageId, setClickedPageId] = useState<string | null>(null);
  const [clickedSectionId, setClickedSectionId] = useState<string | null>(null);
  // Whether the open inspector has edits that haven't been saved yet (the
  // inspector's own `dirty` — see BlueprintInspector) — reported up so a
  // page switch or a different selection can warn before silently
  // discarding them, the same way template apply/reapply and "Start
  // blank" already warn before their own, larger data loss. Reset to
  // `false` the moment a selection change actually goes ahead (below):
  // the inspector for the previous section is about to unmount either
  // way, so there is nothing left to warn about.
  const [inspectorDirty, setInspectorDirty] = useState(false);
  // The inspector's full save-status readout (idle/dirty/saving/saved/
  // error), mirrored here purely for the toolbar's own SaveStatus —
  // `inspectorDirty` above stays the single source of truth for the
  // discard guard.
  const [inspectorStatus, setInspectorStatus] = useState<SaveStatusValue>("idle");

  const activePage = (clickedPageId && pages.find((p) => p.id === clickedPageId)) || pages[0] || null;
  const activeContentPage = activePage ? findContentPage(planning, activePage.id) : undefined;
  const activeSections = useMemo(
    () => (activeContentPage ? [...activeContentPage.sections].sort((a, b) => a.order_index - b.order_index) : []),
    [activeContentPage],
  );
  const selectedSection = activeSections.find((s) => s.id === clickedSectionId) ?? null;

  useEffect(() => {
    onDirtyChange?.(inspectorDirty);
  }, [inspectorDirty, onDirtyChange]);

  /** Resolves to `false` (and shows a confirm dialog) only when the open
   * inspector actually has unsaved edits — otherwise resolves to `true`
   * immediately with no dialog, so ordinary selection changes stay
   * frictionless. */
  async function confirmDiscardIfDirty(): Promise<boolean> {
    if (!inspectorDirty) return true;
    return confirm({
      title: "Discard unsaved changes?",
      description: "This section has edits in the inspector that haven't been saved yet. Continuing will discard them.",
      confirmLabel: "Discard changes",
      danger: true,
    });
  }

  /** Every place selection can change (canvas click, keyboard select,
   * adding a new section, closing the inspector) routes through here, so
   * the unsaved-edits guard above only has to be written once. */
  async function requestSelectSection(id: string | null) {
    if (id === clickedSectionId) return;
    if (!(await confirmDiscardIfDirty())) return;
    setInspectorDirty(false);
    setInspectorStatus("idle");
    setClickedSectionId(id);
  }

  async function handleSelectPage(pageId: string) {
    if (pageId === activePage?.id) return;
    if (!(await confirmDiscardIfDirty())) return;
    setInspectorDirty(false);
    setInspectorStatus("idle");
    setClickedPageId(pageId);
    setClickedSectionId(null);
  }

  async function handleApplyTemplate(template: BlueprintTemplate) {
    if (hasLayout) {
      const ok = await confirm({
        title: `Apply the ${BLUEPRINT_TEMPLATE_LABEL[template]} template?`,
        description:
          "This replaces every page, section and drafted content currently in the Website Blueprint and Content " +
          "Draft with a fresh starting layout. This can't be undone.",
        confirmLabel: "Replace layout",
        danger: true,
      });
      if (!ok) return;
    }
    setApplyingTemplate(template);
    setApplyError(null);
    try {
      const updated = await api.applyBlueprintTemplate(planning.id, { template });
      onUpdated(updated);
      setClickedSectionId(null);
      setMoreOpen(false);
    } catch (err) {
      setApplyError(err instanceof ApiError ? err.message : "Couldn't apply that template.");
    } finally {
      setApplyingTemplate(null);
    }
  }

  async function handleStartBlank() {
    if (hasLayout) {
      const ok = await confirm({
        title: "Start with a blank Blueprint?",
        description:
          "This clears every page, section and drafted content currently in the Website Blueprint and Content " +
          "Draft, leaving a single empty Home page with nothing on it. This can't be undone.",
        confirmLabel: "Start blank",
        danger: true,
      });
      if (!ok) return;
    }
    setStartingBlank(true);
    setApplyError(null);
    // No dedicated "blank template" endpoint exists, and none is needed:
    // a blank start is just "no sitemap pages except one bare Home page,
    // no sections" — composed here from the same sitemap-page endpoints
    // Build Brief already uses, mirroring what apply_blueprint_template
    // does server-side (replace, then seed) without a backend change.
    // Not atomic across these calls the way the server-side template
    // apply is within one request — if a deletion fails partway
    // through, `onUpdated` below still reflects whatever the server
    // actually ended up with, rather than leaving the UI showing stale,
    // already-wrong data.
    let latest = planning;
    try {
      for (const page of pages) {
        latest = await api.deletePlanningSitemapPage(planning.id, page.id);
      }
      latest = await api.addPlanningSitemapPage(planning.id, { title: "Home", page_type: "home", purpose: "" });
      onUpdated(latest);
      setClickedPageId(null);
      setClickedSectionId(null);
      setMoreOpen(false);
    } catch (err) {
      onUpdated(latest);
      setApplyError(
        err instanceof ApiError
          ? err.message
          : "Couldn't start a blank Blueprint. The layout below may be partially cleared — check it and try again.",
      );
    } finally {
      setStartingBlank(false);
    }
  }

  if (!hasLayout) {
    return (
      <div className="space-y-4">
        <p className="text-xs text-fg-muted">
          Choose a starter template to lay out pages and sections, or start blank and build the layout yourself.
        </p>
        {applyError && <p className="text-error">{applyError}</p>}
        <TemplatePickerGrid
          planning={planning}
          applyingTemplate={applyingTemplate}
          startingBlank={startingBlank}
          disabled={pickerBusy}
          onApplyTemplate={handleApplyTemplate}
          onStartBlank={handleStartBlank}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar — the page selector, a save-status readout for whichever
          section is open, and the one "More" menu holding template
          switching. Nothing else lives here: everything less frequent
          moved into that menu, below. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-subtle px-2 py-1.5">
        <div role="tablist" aria-label="Pages" className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {pages.map((page) => (
            <button
              key={page.id}
              type="button"
              role="tab"
              aria-selected={page.id === activePage?.id}
              onClick={() => handleSelectPage(page.id)}
              className={`rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-reduce:transition-none ${
                page.id === activePage?.id ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-surface-hover hover:text-fg"
              }`}
            >
              {page.title}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <SaveStatus status={selectedSection ? inspectorStatus : "idle"} className="hidden sm:block" />
          <BlueprintMoreMenu
            planning={planning}
            open={moreOpen}
            onOpenChange={setMoreOpen}
            applyingTemplate={applyingTemplate}
            startingBlank={startingBlank}
            applyError={applyError}
            onApplyTemplate={handleApplyTemplate}
            onStartBlank={handleStartBlank}
          />
        </div>
      </div>

      {activePage && (
        // `@container`: the 3-pane split follows this section's own
        // width, not the viewport — the step's content column stays
        // well under 1024px even on a wide desktop window (the
        // persistent Website preview panel and step list share the
        // row), so a `lg:` viewport breakpoint would fire without
        // ever having the room and squeeze the canvas unreadably
        // thin. Below the threshold, order-* stacks the canvas
        // (the main thing) above the library and inspector, and the
        // library itself collapses behind a toggle (see
        // `libraryOpenNarrow` above) so it doesn't push the canvas
        // further down the page.
        <div className="@container">
          {/* The third column only exists once a section is actually
              selected — with nothing selected, that space goes back to
              the canvas rather than sitting reserved behind an empty
              inspector. Below @3xl this collapses to one column either
              way (see the comment above), so the inspector just joins
              library/canvas in that same stack, full width, instead of
              squeezing anything. */}
          <div className={`grid gap-3 ${selectedSection ? "@3xl:grid-cols-[260px_minmax(0,1fr)_260px]" : "@3xl:grid-cols-[260px_minmax(0,1fr)]"}`}>
            <div className="order-2 @3xl:order-1">
              <button
                type="button"
                onClick={() => setLibraryOpenNarrow((v) => !v)}
                aria-expanded={libraryOpenNarrow}
                aria-controls="blueprint-library-panel"
                className="mb-2 flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-left transition-colors duration-fast ease-standard hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring @3xl:hidden"
              >
                <span className="text-sm font-medium text-fg">{libraryOpenNarrow ? "Section library" : "Show section library"}</span>
                <ChevronDownIcon
                  aria-hidden="true"
                  className={`h-4 w-4 shrink-0 text-fg-muted transition-transform duration-fast ease-standard motion-reduce:transition-none ${
                    libraryOpenNarrow ? "rotate-180" : ""
                  }`}
                />
              </button>
              <div id="blueprint-library-panel" className={`${libraryOpenNarrow ? "" : "hidden"} @3xl:block`}>
                <BlueprintLibraryPanel
                  planning={planning}
                  sitemapPageId={activePage.id}
                  onUpdated={onUpdated}
                  onAdded={requestSelectSection}
                />
              </div>
            </div>
            <div className="order-1 @3xl:order-2">
              <BlueprintCanvas
                planningId={planning.id}
                sitemapPage={activePage}
                contentPage={activeContentPage}
                sections={activeSections}
                selectedSectionId={clickedSectionId}
                onSelectSection={requestSelectSection}
                onUpdated={onUpdated}
              />
            </div>
            {selectedSection && (
              <div className="order-3">
                <BlueprintInspector
                  key={selectedSection.id}
                  planningId={planning.id}
                  contentPageId={activeContentPage?.id ?? null}
                  section={selectedSection}
                  onUpdated={onUpdated}
                  onClose={() => requestSelectSection(null)}
                  onDirtyChange={setInspectorDirty}
                  onStatusChange={setInspectorStatus}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The "More" menu — a non-modal popover holding the Blueprint's one
 * secondary action, template switching, so it doesn't permanently
 * occupy the toolbar. Adapted from FilterPopover.tsx's own open/
 * outside-click/Escape/focus pattern (this app's closest existing
 * dropdown/menu control) rather than a new shared primitive, since
 * nothing else in the app needs a generic menu component yet.
 */
function BlueprintMoreMenu({
  planning,
  open,
  onOpenChange,
  applyingTemplate,
  startingBlank,
  applyError,
  onApplyTemplate,
  onStartBlank,
}: {
  planning: Planning;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  applyingTemplate: BlueprintTemplate | null;
  startingBlank: boolean;
  applyError: string | null;
  onApplyTemplate: (template: BlueprintTemplate) => void;
  onStartBlank: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const busy = applyingTemplate !== null || startingBlank;

  useEffect(() => {
    if (!open) return;
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panelRef.current)?.focus({ preventScroll: true });

    function handlePointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) onOpenChange(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative shrink-0"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          onOpenChange(false);
          triggerRef.current?.focus();
        }
      }}
      onBlur={(e) => {
        if (open && e.relatedTarget instanceof Node && !rootRef.current?.contains(e.relatedTarget)) onOpenChange(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => onOpenChange(!open)}
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
          aria-label="More Blueprint actions"
          tabIndex={-1}
          className="animate-rise-in absolute right-0 top-full z-30 mt-2 w-[min(30rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-4 shadow-xl outline-none"
        >
          <div className="max-h-[min(70vh,32rem)] space-y-3 overflow-y-auto pr-0.5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Starter template</p>
              <p className="mt-1 text-xs text-fg-subtle">
                {planning.blueprint_template
                  ? `Applied: ${BLUEPRINT_TEMPLATE_LABEL[planning.blueprint_template]}`
                  : "No starter template applied — these pages were set up manually."}
              </p>
            </div>
            {applyError && <p className="text-error">{applyError}</p>}
            <TemplatePickerGrid
              planning={planning}
              applyingTemplate={applyingTemplate}
              startingBlank={startingBlank}
              disabled={busy}
              onApplyTemplate={onApplyTemplate}
              onStartBlank={onStartBlank}
            />
          </div>
          <div className="mt-3 flex justify-end border-t border-border pt-3">
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                triggerRef.current?.focus();
              }}
              className="btn btn-secondary btn-sm"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The template grid shared by the "no layout yet" onboarding view and
 * the More menu's own "Starter template" section — one place that
 * renders the four cards (three templates + "Start blank"), whichever
 * container it's placed in. */
function TemplatePickerGrid({
  planning,
  applyingTemplate,
  startingBlank,
  disabled,
  onApplyTemplate,
  onStartBlank,
}: {
  planning: Planning;
  applyingTemplate: BlueprintTemplate | null;
  startingBlank: boolean;
  disabled: boolean;
  onApplyTemplate: (template: BlueprintTemplate) => void;
  onStartBlank: () => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {BLUEPRINT_TEMPLATES.map((template) => (
        <TemplateCard
          key={template}
          template={template}
          active={planning.blueprint_template === template}
          applying={applyingTemplate === template}
          disabled={disabled}
          onSelect={() => onApplyTemplate(template)}
        />
      ))}
      <BlankStartCard busy={startingBlank} disabled={disabled} onSelect={onStartBlank} />
    </div>
  );
}

function TemplateCard({
  template,
  active,
  applying,
  disabled,
  onSelect,
}: {
  template: BlueprintTemplate;
  active: boolean;
  applying: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const preview = BLUEPRINT_TEMPLATE_PREVIEWS[template];
  return (
    <div className={`card p-3 ${active ? "border-fg" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">{preview.label}</h3>
        {active && <span className="text-xs font-medium text-fg-muted">Current</span>}
      </div>
      <p className="mt-1 text-xs text-fg-subtle">
        {preview.pageCount} page{preview.pageCount === 1 ? "" : "s"}
      </p>
      <ul className="mt-2 space-y-1">
        {preview.outline.map((p) => (
          <li key={p.page} className="text-xs text-fg-muted">
            <span className="font-medium text-fg">{p.page}</span> — {p.sections.map((s) => SECTION_TYPE_LABEL[s]).join(", ")}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-fg-subtle">Header and footer frame every page automatically.</p>
      <button type="button" onClick={onSelect} disabled={disabled} className="btn btn-primary btn-sm mt-3 w-full">
        {applying ? "Applying…" : active ? "Reapply" : "Use this template"}
      </button>
    </div>
  );
}

/** The non-template option in the picker: one empty Home page, nothing
 * auto-placed. Deliberately lighter than TemplateCard (a dashed border,
 * no outline list) — there's no starter layout to preview. */
function BlankStartCard({ busy, disabled, onSelect }: { busy: boolean; disabled: boolean; onSelect: () => void }) {
  return (
    <div className="card border-dashed p-3">
      <h3 className="text-sm font-semibold text-fg">Start blank</h3>
      <p className="mt-1 text-xs text-fg-subtle">One empty Home page — no sections added. Build the layout yourself on the canvas.</p>
      <p className="mt-2 text-[11px] text-fg-subtle">Header and footer frame every page automatically.</p>
      <button type="button" onClick={onSelect} disabled={disabled} className="btn btn-secondary btn-sm mt-3 w-full">
        {busy ? "Starting…" : "Start blank"}
      </button>
    </div>
  );
}
