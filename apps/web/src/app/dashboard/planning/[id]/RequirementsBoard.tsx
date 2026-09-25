"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Planning, type Requirement } from "@/lib/api";
import { useConfirm } from "@/components/ui/ConfirmProvider";
import { SaveStatus, type SaveStatusValue } from "@/components/ui/SaveStatus";
import { Textarea } from "@/components/ui/Textarea";
import { ChevronDownIcon } from "@/components/ui/ControlIcons";
import {
  availableLibraryFeatures,
  availableRecommendedFeatures,
  deriveRecommendedRequirements,
  diffRequirementTemplate,
  FEATURE_DESCRIPTION,
  featureLabel,
  inferAppliedRequirementTemplate,
  isRequirementSelectionCustomised,
  REQUIREMENT_TEMPLATE_DESCRIPTION,
  REQUIREMENT_TEMPLATE_LABEL,
  REQUIREMENT_TEMPLATE_ORDER,
  REQUIREMENT_TEMPLATES,
  type FeatureDefinition,
  type RecommendedFeatureCard,
  type RequirementTemplateKey,
} from "./websiteBlueprintLib";
import { FeatureLibraryCard, PlacedRequirementChip } from "./RequirementCard";

const REQUIREMENT_DRAG_MIME = "application/x-requirement-feature";

type DragPayload = { feature_key: string; source_recommendation_id?: string | null };

type LibraryTab = "recommended" | "all";

/**
 * The requirements board — the simplified, position-independent primary
 * view of "Prepare the website" (see PrepareStep.tsx). A left library of
 * small feature cards (dual add path: drag onto the canvas, or a
 * keyboard-operable "+ Add" button) and a blank canvas the added features
 * auto-arrange into as a wrapping grid of compact chips. Card position
 * and drop coordinates carry no meaning at all — every drop anywhere on
 * the canvas produces the identical result, and there is no reorder
 * control anywhere here — this is the one deliberate difference from the
 * old section library/canvas (BlueprintLibraryPanel/BlueprintCanvas),
 * which the requirements board sits alongside rather than replaces.
 *
 * Every mutation (add/remove/notes) goes straight through
 * `api.addRequirement`/`deleteRequirement`/`updateRequirement`, each of
 * which returns the full updated `Planning` — fed straight into
 * `onUpdated`, the same convention every other Blueprint action already
 * uses. `onDirtyChange` reports whether the notes editor has an unsaved
 * edit, the same signal shape `WebsiteBlueprintSection` already reports
 * for its own inspector, so `PrepareStep`'s "Continue to review" guard
 * can treat both editors the same way.
 */
export function RequirementsBoard({
  planning,
  onUpdated,
  onDirtyChange,
}: {
  planning: Planning;
  onUpdated: (p: Planning) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const confirm = useConfirm();
  const requirements = planning.blueprint_requirements;
  // Derived straight from the canvas's own saved data — never a second
  // "already added" list of its own, so it can't drift out of sync with
  // what's actually saved (see websiteBlueprintLib.ts's own comment on
  // `availableLibraryFeatures`/`availableRecommendedFeatures`, both of
  // which filter by this same set).
  const addedKeys = new Set(requirements.map((r) => r.feature_key));

  const recommended = deriveRecommendedRequirements(planning);
  const availableFeatures = availableLibraryFeatures(addedKeys);
  const availableRecommended = availableRecommendedFeatures(recommended, addedKeys);
  // The canvas's own "address bar" label — the plan's actual saved
  // website URL, the same field (and no other fallback) `page.tsx`'s own
  // header and every other planning-detail view already use as the
  // effective website URL. Still purely cosmetic (see the toolbar's own
  // `aria-hidden` wrapper below) — it never implies the proposed site is
  // live, it just names the real domain this plan is for instead of a
  // generic placeholder.
  const addressBarLabel = planning.website_url && planning.website_url.trim()
    ? planning.website_url.trim()
    : "New website — domain not set";
  const [tab, setTab] = useState<LibraryTab>(() => (recommended.length > 0 ? "recommended" : "all"));
  const [libraryOpenNarrow, setLibraryOpenNarrow] = useState(false);

  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragDepthRef = useRef(0);

  // Which template (if any) the board is currently considered to be
  // "on" — initialised once, on mount, from the board's own real saved
  // feature set (see `inferAppliedRequirementTemplate`'s own comment for
  // why this is never re-derived from a stored preference), then updated
  // only by an explicit, successful "Apply"/"Switch" below. `isCustomised`
  // is a pure comparison against this baseline, recomputed on every
  // render — manually adding/removing a feature never has to touch this
  // state itself, it just makes the comparison stop matching.
  const [appliedTemplate, setAppliedTemplate] = useState<RequirementTemplateKey | null>(() =>
    inferAppliedRequirementTemplate(requirements.map((r) => r.feature_key)),
  );
  const isCustomised = isRequirementSelectionCustomised(
    requirements.map((r) => r.feature_key),
    appliedTemplate,
  );
  const [previewTemplate, setPreviewTemplate] = useState<RequirementTemplateKey | null>(null);
  const [applyingTemplate, setApplyingTemplate] = useState<RequirementTemplateKey | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);

  // The one open notes editor, if any — mirrors the old inspector's
  // single-selection model. `notesDraft`/`notesSaved` track the same
  // "dirty by comparison" pattern BlueprintInspector uses, so switching
  // away from an unsaved edit goes through the same confirm-discard gate.
  const [openId, setOpenId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [notesSaved, setNotesSaved] = useState("");
  const [notesStatus, setNotesStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [notesError, setNotesError] = useState<string | undefined>();
  const notesDirty = openId !== null && notesDraft !== notesSaved;

  useEffect(() => {
    onDirtyChange?.(notesDirty);
  }, [notesDirty, onDirtyChange]);

  // Restores keyboard focus after a disabled-mid-request button becomes
  // interactive again — same convention as BlueprintLibraryPanel/
  // BlueprintCanvas, so a keyboard operator never loses their place after
  // an add/remove.
  const pendingFocusRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (addingKey !== null || busyId !== null) return;
    const trigger = pendingFocusRef.current;
    pendingFocusRef.current = null;
    if (trigger && trigger.isConnected && document.activeElement === document.body) trigger.focus();
  }, [addingKey, busyId]);

  async function confirmDiscardNotesIfDirty(): Promise<boolean> {
    if (!notesDirty) return true;
    return confirm({
      title: "Discard unsaved notes?",
      description: "This feature has a notes edit that hasn't been saved yet. Continuing will discard it.",
      confirmLabel: "Discard changes",
      danger: true,
    });
  }

  async function requestToggleOpen(id: string) {
    const nextId = openId === id ? null : id;
    if (nextId === openId) return;
    if (!(await confirmDiscardNotesIfDirty())) return;
    setOpenId(nextId);
    const req = nextId ? requirements.find((r) => r.id === nextId) : null;
    setNotesDraft(req?.notes ?? "");
    setNotesSaved(req?.notes ?? "");
    setNotesStatus("idle");
    setNotesError(undefined);
  }

  async function addFeature(featureKey: string, sourceRecommendationId: string | null, trigger: HTMLButtonElement | null) {
    // Backstop only — the library no longer offers an already-added
    // feature to add (see availableLibraryFeatures/availableRecommendedFeatures),
    // but this still guards a stale drag payload from an in-flight drag
    // that started before the source card disappeared.
    if (addedKeys.has(featureKey)) return;
    setAddingKey(featureKey);
    setError(null);
    pendingFocusRef.current = trigger;
    try {
      const updated = await api.addRequirement(planning.id, {
        feature_key: featureKey,
        source_recommendation_id: sourceRecommendationId ?? undefined,
      });
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add that feature.");
    } finally {
      setAddingKey(null);
    }
  }

  async function removeRequirement(id: string) {
    setBusyId(id);
    setError(null);
    pendingFocusRef.current = null;
    try {
      const updated = await api.deleteRequirement(planning.id, id);
      onUpdated(updated);
      if (openId === id) {
        setOpenId(null);
        setNotesDraft("");
        setNotesSaved("");
        setNotesStatus("idle");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't remove that feature.");
    } finally {
      setBusyId(null);
    }
  }

  /** Applies (or switches to) a requirement template — see
   * `diffRequirementTemplate`'s own comment. A pure addition (nothing
   * currently selected would be lost) goes straight through, the same
   * "adds its feature set" behaviour as a manual "+ Add"; anything that
   * would remove a currently-selected feature (switching down a tier, or
   * to Blank, or away from a manually-customised selection) previews
   * exactly what would be added/removed — including which removed
   * features carry notes that would be lost — and requires confirmation
   * first (the same `useConfirm()` pattern the old page-layout editor's
   * own template switch already uses), never a silent bulk replace.
   * Removals and additions both go through the exact same
   * `deleteRequirement`/`addRequirement` calls a manual remove/add would,
   * so every existing filter/dedup/persistence rule covers this with no
   * second mechanism — and this never touches `sitemap_pages`/
   * `content_pages` or generates any page content. */
  async function handleApplyTemplate(templateKey: RequirementTemplateKey) {
    const currentKeys = requirements.map((r) => r.feature_key);
    const { toAdd, toRemove } = diffRequirementTemplate(currentKeys, templateKey);
    if (toAdd.length === 0 && toRemove.length === 0) {
      setAppliedTemplate(templateKey);
      return;
    }
    if (toRemove.length > 0) {
      const removedLabels = toRemove.map(featureLabel);
      const notesLost = requirements.filter((r) => toRemove.includes(r.feature_key) && r.notes && r.notes.trim());
      const parts = [
        toAdd.length > 0 ? `add ${toAdd.map(featureLabel).join(", ")}` : null,
        `remove ${removedLabels.join(", ")}`,
      ].filter(Boolean);
      const ok = await confirm({
        title: `Switch to the ${REQUIREMENT_TEMPLATE_LABEL[templateKey]} template?`,
        description:
          `This will ${parts.join(" and ")} from the selected features.` +
          (notesLost.length > 0
            ? ` This discards the notes on ${notesLost.map((r) => featureLabel(r.feature_key)).join(", ")}.`
            : "") +
          " This can't be undone.",
        confirmLabel: "Switch template",
        danger: true,
      });
      if (!ok) return;
    }
    setApplyingTemplate(templateKey);
    setTemplateError(null);
    pendingFocusRef.current = null;
    // Not atomic across these calls the way a single backend endpoint
    // would be (see WebsiteBlueprintSection's own "Start blank", which
    // documents the same trade-off for the old editor's template apply)
    // — if one call fails partway through, `onUpdated` below still
    // reflects whatever the server actually ended up with rather than
    // leaving the UI showing stale, already-wrong data.
    let latest = planning;
    try {
      for (const featureKey of toRemove) {
        const requirement = latest.blueprint_requirements.find((r) => r.feature_key === featureKey);
        if (requirement) latest = await api.deleteRequirement(planning.id, requirement.id);
      }
      for (const featureKey of toAdd) {
        latest = await api.addRequirement(planning.id, { feature_key: featureKey });
      }
      onUpdated(latest);
      setAppliedTemplate(templateKey);
      if (openId && !latest.blueprint_requirements.some((r) => r.id === openId)) {
        setOpenId(null);
        setNotesDraft("");
        setNotesSaved("");
        setNotesStatus("idle");
      }
    } catch (err) {
      setTemplateError(err instanceof ApiError ? err.message : "Couldn't apply that template.");
    } finally {
      setApplyingTemplate(null);
    }
  }

  async function saveNotes() {
    if (!openId) return;
    setNotesStatus("saving");
    setNotesError(undefined);
    try {
      const updated = await api.updateRequirement(planning.id, openId, { notes: notesDraft.trim() || null });
      onUpdated(updated);
      setNotesSaved(notesDraft);
      setNotesStatus("saved");
    } catch (err) {
      setNotesError(err instanceof ApiError ? err.message : "Couldn't save these notes.");
      setNotesStatus("error");
    }
  }

  function cancelNotesEdit() {
    setNotesDraft(notesSaved);
    setNotesStatus("idle");
    setNotesError(undefined);
  }

  function handleDragStart(e: React.DragEvent, payload: DragPayload) {
    e.dataTransfer.setData(REQUIREMENT_DRAG_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "copy";
  }

  function endDrag() {
    dragDepthRef.current = 0;
    setDragOver(false);
  }

  function handleCanvasDrop(e: React.DragEvent) {
    e.preventDefault();
    endDrag();
    const raw = e.dataTransfer.getData(REQUIREMENT_DRAG_MIME);
    if (!raw) return;
    let payload: DragPayload;
    try {
      payload = JSON.parse(raw) as DragPayload;
    } catch {
      return;
    }
    // Dropping anywhere in the canvas produces the identical result —
    // there is deliberately no coordinate/insertion-point math here at
    // all, unlike BlueprintCanvas's gap model.
    addFeature(payload.feature_key, payload.source_recommendation_id ?? null, null);
  }

  const openRequirement = openId ? requirements.find((r) => r.id === openId) ?? null : null;
  const notesDisplayStatus: SaveStatusValue =
    notesStatus === "saving" ? "saving" : notesStatus === "error" ? "error" : notesDirty ? "dirty" : notesStatus === "saved" ? "saved" : "idle";

  const boardStatus: SaveStatusValue =
    addingKey !== null || busyId !== null || notesStatus === "saving"
      ? "saving"
      : error
        ? "error"
        : notesStatus === "saved"
          ? "saved"
          : "idle";

  return (
    // `flex h-full min-h-0 flex-col` — when PrepareStep gives this
    // component a bounded height (wide screens, see that file's own
    // comment), the `@container` row below is the one `flex-1 min-h-0`
    // child that claims it; the feature count/save-status row stays
    // natural height so it's never pushed out of view. On a narrow/short
    // screen (no bounded ancestor) this is all inert and the board just
    // sizes to its natural content, same as before.
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="@container min-h-0 flex-1">
        {/* Flex, not CSS Grid, specifically so both columns can share the
            row's full height (`h-full`) and each scroll internally — a
            grid track's height doesn't hand a usable definite size to an
            `h-full` child the same simple way a flex item's does. Still
            switches from a stacked column to a 260px-library/flexible-
            canvas row at the same `@3xl` container-query breakpoint as
            before. */}
        <div className="flex h-full min-h-0 flex-col gap-3 @3xl:flex-row">
          <div className="order-2 shrink-0 @3xl:order-1 @3xl:flex @3xl:h-full @3xl:min-h-0 @3xl:w-[260px] @3xl:flex-col">
            <button
              type="button"
              onClick={() => setLibraryOpenNarrow((v) => !v)}
              aria-expanded={libraryOpenNarrow}
              aria-controls="requirements-library-panel"
              className="mb-2 flex w-full shrink-0 items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-left transition-colors duration-fast ease-standard hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring @3xl:hidden"
            >
              <span className="text-sm font-medium text-fg">{libraryOpenNarrow ? "Feature library" : "Show feature library"}</span>
              <ChevronDownIcon
                aria-hidden="true"
                className={`h-4 w-4 shrink-0 text-fg-muted transition-transform duration-fast ease-standard motion-reduce:transition-none ${
                  libraryOpenNarrow ? "rotate-180" : ""
                }`}
              />
            </button>
            <div
              id="requirements-library-panel"
              className={`${libraryOpenNarrow ? "flex flex-col" : "hidden"} @3xl:flex @3xl:h-full @3xl:min-h-0 @3xl:flex-col`}
            >
              <FeatureLibrary
                tab={tab}
                onTabChange={setTab}
                recommendedTotal={recommended.length}
                availableRecommended={availableRecommended}
                availableFeatures={availableFeatures}
                addingKey={addingKey}
                onAdd={addFeature}
                onDragStart={handleDragStart}
              />
            </div>
          </div>

          <div className="order-1 flex min-h-0 min-w-0 flex-1 flex-col @3xl:order-2">
            <TemplateSelector
              appliedTemplate={appliedTemplate}
              isCustomised={isCustomised}
              previewTemplate={previewTemplate}
              applyingTemplate={applyingTemplate}
              onPreview={setPreviewTemplate}
              onApply={handleApplyTemplate}
            />
            {templateError && <p className="mb-2 shrink-0 text-error">{templateError}</p>}
            {/* The same minimal browser-chrome frame as BlueprintCanvas,
                but with no dashed empty-state box and no fixed header/
                footer chrome — this view has neither pages nor a
                header/footer concept. `flex-1` (not `h-full`) now that the
                template selector above it shares this same column — this
                claims whatever height that selector's own natural
                (`shrink-0`) height leaves behind, rather than both trying
                to claim the full column height at once. */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
              <div
                className="flex shrink-0 items-center gap-3 border-b border-border bg-surface-subtle px-3 py-2"
                aria-hidden="true"
              >
                <div className="flex shrink-0 gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
                  <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
                  <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
                </div>
                <div
                  className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface px-3 py-1 text-center text-[11px] text-fg-subtle"
                  title={addressBarLabel}
                >
                  {addressBarLabel}
                </div>
              </div>

              <div
                // A modest floor (`min-h`), not a generous one — on wide
                // screens PrepareStep hands the frame above a real, bounded
                // height to fill (`flex-1`) via its own calc'd height (see
                // PrepareStep's `BOARD_HEIGHT_CSS`), and this scrolls its
                // own content (`overflow-y-auto`) within whatever that
                // leaves it; on a narrow/short screen with no bounded
                // ancestor, `flex-1` has nothing to fill so this falls back
                // to its natural content height, never shorter than the
                // floor. The floor stays low specifically so it can never
                // exceed PrepareStep's own worst-case bounded height and
                // get clipped by the frame's `overflow-hidden` above — a
                // short screen should show a smaller (but fully visible)
                // canvas, never a partly-clipped one. The whole area
                // (including the blank space below the cards) stays
                // droppable — drag/drop and scroll handlers live on this
                // same div, so whichever scrollbar is actually active
                // (this div's own, or the page's) is what a long drag
                // scrolls.
                className={`min-h-[140px] flex-1 overflow-y-auto p-4 transition-colors duration-fast ease-standard motion-reduce:transition-none ${
                  dragOver ? "bg-accent-soft" : "bg-surface"
                }`}
                onDragEnter={(e) => {
                  e.preventDefault();
                  dragDepthRef.current += 1;
                  setDragOver(true);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDragLeave={() => {
                  dragDepthRef.current -= 1;
                  if (dragDepthRef.current <= 0) endDrag();
                }}
                onDrop={handleCanvasDrop}
              >
                {requirements.length === 0 ? (
                  <p className="py-10 text-center text-sm text-fg-subtle">
                    Drag a feature in from the library, or use its “+ Add” button.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {requirements.map((r) => (
                      <PlacedRequirementChip
                        key={r.id}
                        featureKey={r.feature_key}
                        suggested={Boolean(r.source_recommendation_id)}
                        hasNotes={Boolean(r.notes && r.notes.trim())}
                        selected={openId === r.id}
                        busy={busyId === r.id}
                        onToggle={() => requestToggleOpen(r.id)}
                        onRemove={() => removeRequirement(r.id)}
                      />
                    ))}
                  </div>
                )}

                {openRequirement && (
                  <NotesEditor
                    requirement={openRequirement}
                    draft={notesDraft}
                    dirty={notesDirty}
                    status={notesDisplayStatus}
                    errorText={notesError}
                    onChange={(value) => {
                      setNotesDraft(value);
                      if (notesStatus !== "saving") setNotesStatus("idle");
                    }}
                    onSave={saveNotes}
                    onCancel={cancelNotesEdit}
                    onClose={() => requestToggleOpen(openRequirement.id)}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-fg-muted">
          {requirements.length === 0
            ? "No features selected yet."
            : `${requirements.length} feature${requirements.length === 1 ? "" : "s"} selected`}
        </p>
        <SaveStatus status={boardStatus} className="w-auto" />
      </div>
      {error && <p className="shrink-0 text-error">{error}</p>}
    </div>
  );
}

/** Left-column library — "Recommended" (derived from accepted "Add"
 * recommendations) and "All features" (the full starter set), same tab
 * convention as BlueprintLibraryPanel. Both lists arrive already filtered
 * to what isn't on the canvas yet (see availableLibraryFeatures/
 * availableRecommendedFeatures) — this component never re-derives or
 * second-guesses that filter, and never renders an "Added" state. */
function FeatureLibrary({
  tab,
  onTabChange,
  recommendedTotal,
  availableRecommended,
  availableFeatures,
  addingKey,
  onAdd,
  onDragStart,
}: {
  tab: LibraryTab;
  onTabChange: (tab: LibraryTab) => void;
  /** Every recommended card, added or not — distinguishes "no
   * recommendations map to a feature at all" from "they do, but every one
   * is already added" below. */
  recommendedTotal: number;
  availableRecommended: RecommendedFeatureCard[];
  availableFeatures: FeatureDefinition[];
  addingKey: string | null;
  onAdd: (featureKey: string, sourceRecommendationId: string | null, trigger: HTMLButtonElement | null) => void;
  onDragStart: (e: React.DragEvent, payload: DragPayload) => void;
}) {
  return (
    // `h-full`/`flex-1` (paired with the list's own `min-h-0`) let this
    // fill exactly the same height as the canvas frame beside it whenever
    // an ancestor hands this a bounded height (see RequirementsBoard's own
    // comment); the list's `max-h-[70vh]` is a fallback cap for when there
    // is no bounded ancestor (narrow/mobile, where the library is a
    // collapsed-by-default toggle panel) so a very long list still scrolls
    // internally instead of growing the page unreasonably tall.
    <div className="card flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="shrink-0">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Feature library</h3>
        <div role="tablist" aria-label="Feature library view" className="mt-2 flex gap-1 rounded-md bg-surface-subtle p-0.5">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "recommended"}
            onClick={() => onTabChange("recommended")}
            className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring motion-reduce:transition-none ${
              tab === "recommended" ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg"
            }`}
          >
            Recommended
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "all"}
            onClick={() => onTabChange("all")}
            className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring motion-reduce:transition-none ${
              tab === "all" ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg"
            }`}
          >
            All features
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5 max-h-[70vh]">
        {tab === "recommended" ? (
          recommendedTotal === 0 ? (
            <div className="rounded-md border border-dashed border-border p-3 text-center">
              <p className="text-xs text-fg-subtle">
                Nothing in the accepted recommendations or the website audit maps to a feature yet.
              </p>
              <button type="button" onClick={() => onTabChange("all")} className="btn btn-secondary btn-sm mt-2">
                Browse all features
              </button>
            </div>
          ) : availableRecommended.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-3 text-center">
              <p className="text-xs text-fg-subtle">Every recommended feature has been added.</p>
              <button type="button" onClick={() => onTabChange("all")} className="btn btn-secondary btn-sm mt-2">
                Browse all features
              </button>
            </div>
          ) : (
            <ul className="space-y-2">
              {availableRecommended.map((item) => (
                <li key={item.featureKey}>
                  <FeatureLibraryCard
                    featureKey={item.featureKey}
                    description={item.reason}
                    busy={addingKey !== null}
                    isBusy={addingKey === item.featureKey}
                    onDragStart={(e) =>
                      onDragStart(e, { feature_key: item.featureKey, source_recommendation_id: item.sourceRecommendationId })
                    }
                    onAdd={(trigger) => onAdd(item.featureKey, item.sourceRecommendationId, trigger)}
                  />
                </li>
              ))}
            </ul>
          )
        ) : availableFeatures.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-3 text-center text-xs text-fg-subtle">
            All features added.
          </p>
        ) : (
          <ul className="space-y-2">
            {availableFeatures.map((feature) => (
              <li key={feature.key}>
                <FeatureLibraryCard
                  featureKey={feature.key}
                  description={FEATURE_DESCRIPTION[feature.key]}
                  busy={addingKey !== null}
                  isBusy={addingKey === feature.key}
                  onDragStart={(e) => onDragStart(e, { feature_key: feature.key })}
                  onAdd={(trigger) => onAdd(feature.key, null, trigger)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * The requirements board's own compact template picker — directly above
 * the canvas, not buried in `PrepareStep`'s "More" menu (that menu stays
 * scoped to the OLD detailed page-layout editor/Reference, see
 * `PrepareMoreMenu`). Four always-visible options; hovering or focusing
 * one expands a one-line preview of exactly what it includes before
 * anything is applied — never a bare label the operator has to guess at.
 * Applying/switching (`onApply`) is the parent's job (see
 * `handleApplyTemplate`'s own comment for the add/remove/confirm rules);
 * this component only renders the picker and its preview.
 */
function TemplateSelector({
  appliedTemplate,
  isCustomised,
  previewTemplate,
  applyingTemplate,
  onPreview,
  onApply,
}: {
  appliedTemplate: RequirementTemplateKey | null;
  isCustomised: boolean;
  previewTemplate: RequirementTemplateKey | null;
  applyingTemplate: RequirementTemplateKey | null;
  onPreview: (key: RequirementTemplateKey | null) => void;
  onApply: (key: RequirementTemplateKey) => void;
}) {
  const shown = previewTemplate ?? appliedTemplate;
  const shownFeatures = shown ? REQUIREMENT_TEMPLATES[shown] : null;
  return (
    <div className="mb-2 shrink-0 rounded-lg border border-border bg-surface-subtle p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-fg-muted">Template</span>
        <div role="group" aria-label="Website requirement templates" className="flex flex-wrap gap-1">
          {REQUIREMENT_TEMPLATE_ORDER.map((key) => {
            const isApplied = appliedTemplate === key;
            return (
              <button
                key={key}
                type="button"
                disabled={applyingTemplate !== null}
                aria-pressed={isApplied}
                onClick={() => onApply(key)}
                onMouseEnter={() => onPreview(key)}
                onMouseLeave={() => onPreview(null)}
                onFocus={() => onPreview(key)}
                onBlur={() => onPreview(null)}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50 ${
                  isApplied ? "border-fg bg-surface text-fg" : "border-border bg-surface text-fg-muted hover:text-fg"
                }`}
              >
                {applyingTemplate === key ? "Applying…" : REQUIREMENT_TEMPLATE_LABEL[key]}
              </button>
            );
          })}
        </div>
        {appliedTemplate !== null && isCustomised && (
          <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-fg-subtle" title="The selected features no longer exactly match the applied template">
            Customised
          </span>
        )}
      </div>
      <p className="mt-1.5 text-[11px] text-fg-subtle">
        {shown
          ? shownFeatures && shownFeatures.length > 0
            ? `${REQUIREMENT_TEMPLATE_LABEL[shown]} includes: ${shownFeatures.map(featureLabel).join(", ")}.`
            : `${REQUIREMENT_TEMPLATE_LABEL[shown]} — ${REQUIREMENT_TEMPLATE_DESCRIPTION[shown]}`
          : "Hover or focus a template to preview what it includes."}
      </p>
    </div>
  );
}

/** The lightweight inline notes editor for whichever requirement is open
 * — a small expand under the chip grid, not a separate inspector column.
 * Explicit Save/Cancel (no autosave) so "dirty" stays a simple by-
 * comparison check the same way BlueprintInspector's does, which is what
 * lets PrepareStep's "Continue to review" guard reuse that exact
 * discard-confirmation pattern instead of reasoning about in-flight
 * debounced saves. */
function NotesEditor({
  requirement,
  draft,
  dirty,
  status,
  errorText,
  onChange,
  onSave,
  onCancel,
  onClose,
}: {
  requirement: Requirement;
  draft: string;
  dirty: boolean;
  status: SaveStatusValue;
  errorText?: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="mt-3 space-y-2 rounded-lg border border-border bg-surface-subtle p-3"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="requirement-notes" className="field-label text-xs">
          Notes — {featureLabel(requirement.feature_key)}
        </label>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close notes"
          className="shrink-0 rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
            <path d="M4.22 4.22a.75.75 0 0 1 1.06 0L10 8.94l4.72-4.72a.75.75 0 1 1 1.06 1.06L11.06 10l4.72 4.72a.75.75 0 1 1-1.06 1.06L10 11.06l-4.72 4.72a.75.75 0 0 1-1.06-1.06L8.94 10 4.22 5.28a.75.75 0 0 1 0-1.06Z" />
          </svg>
        </button>
      </div>
      <Textarea
        id="requirement-notes"
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="input"
        placeholder="Anything specific about this feature — optional"
      />
      <div className="flex items-center gap-2">
        <button type="button" onClick={onSave} disabled={!dirty || status === "saving"} className="btn btn-secondary btn-sm">
          {status === "saving" ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onCancel} disabled={!dirty} className="btn btn-secondary btn-sm">
          Cancel
        </button>
        <SaveStatus status={status} errorText={errorText} />
      </div>
    </div>
  );
}
