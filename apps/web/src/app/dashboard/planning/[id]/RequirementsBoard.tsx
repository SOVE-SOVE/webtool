"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { api, ApiError, type Planning, type Requirement } from "@/lib/api";
import { useConfirm } from "@/components/ui/ConfirmProvider";
import { SaveStatus, type SaveStatusValue } from "@/components/ui/SaveStatus";
import { Textarea } from "@/components/ui/Textarea";
import { ChevronDownIcon } from "@/components/ui/ControlIcons";
import { SearchInput } from "@/components/ui/SearchInput";
import { CompactSelect, type SelectOption } from "@/components/ui/CompactSelect";
import {
  acceptedRecommendationIdsForFeature,
  availableLibraryFeatures,
  conflictingSelections,
  availableRecommendedFeatures,
  computeRequirementEvidence,
  deriveRecommendedRequirements,
  describeRequirementTemplateEffect,
  diffRequirementTemplate,
  FEATURE_BY_KEY,
  FEATURE_CATEGORY_LABEL,
  FEATURE_CATEGORY_ORDER,
  FEATURE_DESCRIPTION,
  featureKind,
  featureLabel,
  filterFeatureLibrary,
  inferAppliedRequirementTemplate,
  isRequirementSelectionCustomised,
  REQUIREMENT_TEMPLATE_BEST_FOR,
  REQUIREMENT_TEMPLATE_LABEL,
  REQUIREMENT_TEMPLATE_ORDER,
  REQUIREMENT_TEMPLATE_SUMMARY,
  REQUIREMENT_TEMPLATES,
  TEMPLATE_FEATURE_QUALIFIER,
  recommendationIdsForFeature,
  type FeatureCategory,
  type FeatureDefinition,
  type RecommendedFeatureCard,
  type RequirementEvidence,
  type RequirementTemplateKey,
} from "./websiteBlueprintLib";
import { FeatureLibraryCard, PlacedRequirementChip } from "./RequirementCard";
import { InspirationStrip } from "./InspirationStrip";

const REQUIREMENT_DRAG_MIME = "application/x-requirement-feature";

type DragPayload = { feature_key: string; source_recommendation_id?: string | null };

type LibraryTab = "recommended" | "all";

type CategoryFilter = FeatureCategory | "all";

const CATEGORY_FILTER_OPTIONS: SelectOption<CategoryFilter>[] = [
  { value: "all", label: "All categories" },
  ...FEATURE_CATEGORY_ORDER.map((c) => ({ value: c, label: FEATURE_CATEGORY_LABEL[c] })),
];

/**
 * The requirements board — the simplified, position-independent primary
 * view of the Plan step (see PlanStep.tsx). A left library of
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
 * for its own inspector, so PlanStep can report both editors to
 * page.tsx's single leave-the-step guard the same way.
 *
 * `onOpenRecommendations` (optional) lets the Recommended view's empty
 * state point at wherever the host step keeps Generate — PlanStep's
 * "Site-wide improvements" panel — when no recommendations exist yet.
 *
 * `lead` (optional) feeds `computeRequirementEvidence` — the read-only
 * "Already on file" list inside each chip's notes editor. Without it,
 * lead-held facts are simply not shown, and nothing is ever asked on a
 * guess.
 *
 * Attached inspiration sites (`planning.inspiration_references`) show as
 * `InspirationStrip` — a thumbnail row below the canvas frame, inside this
 * bounded layout so the canvas still fits; never feature chips. Its
 * detail editor's unsaved state joins `onDirtyChange`.
 * `onOpenInspiration` (optional) lets the strip's "+ Add" tile open the
 * host step's library drawer.
 */
export function RequirementsBoard({
  planning,
  lead,
  onUpdated,
  onDirtyChange,
  onOpenRecommendations,
  onOpenInspiration,
}: {
  planning: Planning;
  lead?: {
    business_phone: string | null;
    business_email: string | null;
    suburb?: string | null;
    state?: string | null;
  } | null;
  onUpdated: (p: Planning) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onOpenRecommendations?: () => void;
  onOpenInspiration?: () => void;
}) {
  const confirm = useConfirm();
  const requirements = planning.blueprint_requirements;
  // Derived straight from the canvas's own saved data — never a second
  // "already added" list of its own, so it can't drift out of sync with
  // what's actually saved (see websiteBlueprintLib.ts's own comment on
  // `availableLibraryFeatures`/`availableRecommendedFeatures`, both of
  // which filter by this same set).
  const addedKeys = new Set(requirements.map((r) => r.feature_key));

  // Visual/style options are a matter of taste, never evidence-backed —
  // so a design preference is never offered as "Recommended", whatever
  // the mapping upstream returns.
  const recommended = deriveRecommendedRequirements(planning).filter((r) => featureKind(r.featureKey) !== "design");
  const availableFeatures = availableLibraryFeatures(addedKeys);
  const availableRecommended = availableRecommendedFeatures(recommended, addedKeys);
  // What's already on file for each selected feature — read-only context
  // for the notes editor, never a step to complete.
  const evidenceByKey = new Map(computeRequirementEvidence(planning, lead ?? null).map((e) => [e.featureKey, e]));
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
  // The inspiration strip's own detail editor — independent of the notes
  // editor, reported up together as one flag.
  const [inspirationDirty, setInspirationDirty] = useState(false);

  useEffect(() => {
    onDirtyChange?.(notesDirty || inspirationDirty);
  }, [notesDirty, inspirationDirty, onDirtyChange]);

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

  async function requestToggleOpen(id: string): Promise<boolean> {
    const nextId = openId === id ? null : id;
    if (nextId === openId) return false;
    if (!(await confirmDiscardNotesIfDirty())) return false;
    setOpenId(nextId);
    const req = nextId ? requirements.find((r) => r.id === nextId) : null;
    setNotesDraft(req?.notes ?? "");
    setNotesSaved(req?.notes ?? "");
    setNotesStatus("idle");
    setNotesError(undefined);
    return true;
  }

  async function addFeature(featureKey: string, sourceRecommendationId: string | null, trigger: HTMLButtonElement | null) {
    // Backstop only — the library no longer offers an already-added
    // feature to add (see availableLibraryFeatures/availableRecommendedFeatures),
    // but this still guards a stale drag payload from an in-flight drag
    // that started before the source card disappeared.
    if (addedKeys.has(featureKey)) return;
    // Directly conflicting choices (e.g. light vs dark appearance): say
    // so and let the user replace or cancel — never a silent swap.
    const conflicts = conflictingSelections(featureKey, addedKeys);
    if (conflicts.length > 0) {
      const ok = await confirm({
        title: `Replace ${conflicts.map(featureLabel).join(", ")}?`,
        description:
          `${featureLabel(featureKey)} and ${conflicts.map(featureLabel).join(", ")} can't both apply — ` +
          `the site can only have one. Replacing removes ${conflicts.map(featureLabel).join(", ")}` +
          (requirements.some((r) => conflicts.includes(r.feature_key) && r.notes && r.notes.trim())
            ? " and its notes."
            : "."),
        confirmLabel: `Replace with ${featureLabel(featureKey)}`,
      });
      if (!ok) return;
    }
    setAddingKey(featureKey);
    setError(null);
    pendingFocusRef.current = trigger;
    try {
      let latest = planning;
      for (const conflictKey of conflicts) {
        const existing = latest.blueprint_requirements.find((r) => r.feature_key === conflictKey);
        if (existing) {
          latest = await api.deleteRequirement(
            planning.id,
            existing.id,
            acceptedRecommendationIdsForFeature(latest, conflictKey),
          );
          onUpdated(latest);
        }
      }
      // Adding a feature IS the decision on every recommendation that
      // supports it — however it was added (Recommended, All features,
      // drag/drop) — so they're accepted in the same request, never left
      // for a second "select it again" step elsewhere.
      const acceptIds = recommendationIdsForFeature(planning, featureKey);
      const updated = await api.addRequirement(planning.id, {
        feature_key: featureKey,
        source_recommendation_id: sourceRecommendationId ?? acceptIds[0] ?? undefined,
        accept_recommendation_ids: acceptIds,
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
      // Removing deselects: accepted supporting recommendations go back
      // to proposed (never deleted or dismissed), so the card reappears
      // under Recommended with its evidence intact.
      const featureKey = requirements.find((r) => r.id === id)?.feature_key;
      const deselectIds = featureKey ? acceptedRecommendationIdsForFeature(planning, featureKey) : [];
      const updated = await api.deleteRequirement(planning.id, id, deselectIds);
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
        if (requirement) {
          latest = await api.deleteRequirement(
            planning.id,
            requirement.id,
            acceptedRecommendationIdsForFeature(latest, featureKey),
          );
        }
      }
      for (const featureKey of toAdd) {
        const acceptIds = recommendationIdsForFeature(latest, featureKey);
        latest = await api.addRequirement(planning.id, {
          feature_key: featureKey,
          source_recommendation_id: acceptIds[0],
          accept_recommendation_ids: acceptIds,
        });
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
    // `flex h-full min-h-0 flex-col` — when PlanStep gives this
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
                hasAnyRecommendations={planning.recommendations.length > 0}
                onOpenRecommendations={onOpenRecommendations}
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
              requirements={requirements}
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
                // screens PlanStep hands the frame above a real, bounded
                // height to fill (`flex-1`) via its own calc'd height (see
                // PlanStep's `BOARD_HEIGHT_CSS`), and this scrolls its
                // own content (`overflow-y-auto`) within whatever that
                // leaves it; on a narrow/short screen with no bounded
                // ancestor, `flex-1` has nothing to fill so this falls back
                // to its natural content height, never shorter than the
                // floor. The floor stays low specifically so it can never
                // exceed PlanStep's own worst-case bounded height and
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
                  // Empty plans only — a saved selection never sees this,
                  // so it never nudges anyone to restart from a template.
                  <div className="py-10 text-center">
                    <p className="text-sm font-medium text-fg">Pick a template above to start</p>
                    <p className="mt-1 text-xs text-fg-subtle">
                      Or add features from the library — drag one in, or use its “+ Add to plan” button.
                    </p>
                  </div>
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
                    evidence={evidenceByKey.get(openRequirement.feature_key)}
                    leadId={planning.lead_id}
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
            <InspirationStrip
              planning={planning}
              onUpdated={onUpdated}
              onDirtyChange={setInspirationDirty}
              onOpenLibrary={onOpenInspiration}
            />
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

/** Left-column library — "Recommended" (evidence-backed feature
 * suggestions: proposed or accepted "add"/"improve" recommendations that
 * map to a feature, plus audit findings — see
 * `deriveRecommendedRequirements`) and "All features" (the full starter
 * set), same tab convention as BlueprintLibraryPanel. Both lists arrive already filtered
 * to what isn't on the canvas yet (see availableLibraryFeatures/
 * availableRecommendedFeatures) — this component never re-derives or
 * second-guesses that filter, and never renders an "Added" state. */
function FeatureLibrary({
  tab,
  onTabChange,
  recommendedTotal,
  hasAnyRecommendations,
  onOpenRecommendations,
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
  /** Whether the plan has any recommendations at all — when it doesn't,
   * the empty state offers Generate (via `onOpenRecommendations`) rather
   * than implying the evidence was looked at and came up empty. */
  hasAnyRecommendations: boolean;
  onOpenRecommendations?: () => void;
  availableRecommended: RecommendedFeatureCard[];
  availableFeatures: FeatureDefinition[];
  addingKey: string | null;
  onAdd: (featureKey: string, sourceRecommendationId: string | null, trigger: HTMLButtonElement | null) => void;
  onDragStart: (e: React.DragEvent, payload: DragPayload) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const filtered = filterFeatureLibrary(availableFeatures, query, category);
  // Grouped under small category headings in catalogue order when every
  // category is showing; a single chosen category needs no heading.
  const groups =
    category === "all"
      ? FEATURE_CATEGORY_ORDER.map((c) => ({ category: c, features: filtered.filter((f) => f.category === c) })).filter(
          (g) => g.features.length > 0,
        )
      : [{ category, features: filtered }];
  const filtering = query.trim() !== "" || category !== "all";
  const groupIdPrefix = useId();

  function renderCard(feature: FeatureDefinition) {
    return (
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
    );
  }

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
        {tab === "all" && availableFeatures.length > 0 && (
          <div className="mt-2 space-y-1.5">
            <SearchInput
              value={query}
              onValueChange={setQuery}
              placeholder="Search features"
              aria-label="Search features"
              className="h-8 px-2 text-xs [&_input]:text-xs"
            />
            <CompactSelect
              value={category}
              onValueChange={setCategory}
              options={CATEGORY_FILTER_OPTIONS}
              aria-label="Feature category"
              className="h-8 px-2 text-xs"
            />
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5 max-h-[70vh]">
        {tab === "recommended" ? (
          recommendedTotal === 0 ? (
            <div className="rounded-md border border-dashed border-border p-3 text-center">
              <p className="text-xs text-fg-subtle">
                {hasAnyRecommendations
                  ? "No recommendation or audit finding maps to a website feature yet."
                  : "No recommendations yet. Generate them to see evidence-backed features here."}
              </p>
              <div className="mt-2 flex flex-col gap-1.5">
                {!hasAnyRecommendations && onOpenRecommendations && (
                  <button type="button" onClick={onOpenRecommendations} className="btn btn-primary btn-sm">
                    Generate recommendations
                  </button>
                )}
                <button type="button" onClick={() => onTabChange("all")} className="btn btn-secondary btn-sm">
                  Browse all features
                </button>
              </div>
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
                    recommendation={{
                      count: item.recommendationIds.length,
                      acceptedEarlier: item.hasAcceptedRecommendation,
                    }}
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
        ) : filtered.length === 0 ? (
          <p className="px-1 py-3 text-center text-xs text-fg-subtle">No features match — try another search</p>
        ) : category === "all" ? (
          <div className="space-y-3">
            {groups.map((group) => (
              <section key={group.category} aria-labelledby={`${groupIdPrefix}-${group.category}`}>
                {/* Sticky within the list's own scroll, so a long group
                    keeps its label in view. */}
                <h4
                  id={`${groupIdPrefix}-${group.category}`}
                  className="sticky top-0 z-[1] bg-surface pb-1 text-[11px] font-medium text-fg-muted"
                >
                  {FEATURE_CATEGORY_LABEL[group.category]}
                </h4>
                <ul className="space-y-2">{group.features.map(renderCard)}</ul>
              </section>
            ))}
          </div>
        ) : (
          <ul className="space-y-2">{filtered.map(renderCard)}</ul>
        )}
      </div>
      {/* Always mounted so screen readers pick up the change as the
          filter narrows; silent until a search or category is set. */}
      <p className="sr-only" role="status">
        {tab === "all" && filtering
          ? filtered.length === 0
            ? "No features match"
            : `${filtered.length} feature${filtered.length === 1 ? "" : "s"} shown`
          : ""}
      </p>
    </div>
  );
}

/** How many inclusion chips the template details show before "+N more". */
const TEMPLATE_CHIP_LIMIT = 4;

function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** A feature's library description plus, where a template could read as
 * promising a working integration, its `TEMPLATE_FEATURE_QUALIFIER`. */
function templateFeatureTitle(featureKey: string): string {
  return [FEATURE_DESCRIPTION[featureKey], TEMPLATE_FEATURE_QUALIFIER[featureKey]].filter(Boolean).join(" ");
}

/**
 * The requirements board's own compact template picker — directly above
 * the canvas, not buried in PlanStep's "More" menu (that menu stays
 * scoped to the OLD detailed page-layout editor/Reference, see
 * `PlanMoreMenu`). Four always-visible options; hovering or focusing
 * one previews what it includes and exactly what applying it would do
 * to the current selection (`describeRequirementTemplateEffect`, the same
 * diff `handleApplyTemplate` runs) before anything is applied.
 *
 * The details area shows `previewTemplate ?? lastInspected ??
 * appliedTemplate`: leaving a button (pointer or focus) keeps the last
 * inspected template's details on screen, so the pointer or Tab can
 * reach its "See everything included" disclosure. That memory is cleared
 * only once both pointer and focus have left the whole selector, which
 * falls back to the applied template. The disclosure is keyed to the
 * template it was opened for, so it collapses when the shown template
 * changes. Applying/switching (`onApply`) is the parent's job (see
 * `handleApplyTemplate`'s own comment for the add/remove/confirm rules);
 * this component only renders the picker and its details.
 */
function TemplateSelector({
  requirements,
  appliedTemplate,
  isCustomised,
  previewTemplate,
  applyingTemplate,
  onPreview,
  onApply,
}: {
  requirements: Requirement[];
  appliedTemplate: RequirementTemplateKey | null;
  isCustomised: boolean;
  previewTemplate: RequirementTemplateKey | null;
  applyingTemplate: RequirementTemplateKey | null;
  onPreview: (key: RequirementTemplateKey | null) => void;
  onApply: (key: RequirementTemplateKey) => void;
}) {
  const [lastInspected, setLastInspected] = useState<RequirementTemplateKey | null>(null);
  const [expandedFor, setExpandedFor] = useState<RequirementTemplateKey | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pointerInsideRef = useRef(false);
  const listId = useId();

  const shown = previewTemplate ?? lastInspected ?? appliedTemplate;
  const shownFeatures = shown ? REQUIREMENT_TEMPLATES[shown] : [];
  const expanded = shown !== null && expandedFor === shown;
  const effect = shown ? describeRequirementTemplateEffect(requirements, shown) : null;

  function inspect(key: RequirementTemplateKey) {
    setLastInspected(key);
    onPreview(key);
  }

  return (
    <div
      ref={containerRef}
      className="mb-2 shrink-0 rounded-lg border border-border bg-surface-subtle p-2"
      onMouseEnter={() => {
        pointerInsideRef.current = true;
      }}
      onMouseLeave={() => {
        pointerInsideRef.current = false;
        if (!containerRef.current?.contains(document.activeElement)) setLastInspected(null);
      }}
      onBlur={(e) => {
        if (!pointerInsideRef.current && !e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setLastInspected(null);
        }
      }}
    >
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
                onMouseEnter={() => inspect(key)}
                onMouseLeave={() => onPreview(null)}
                onFocus={() => inspect(key)}
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

      {shown && effect ? (
        <div className="mt-2 space-y-1.5">
          <p className="text-xs text-fg-muted">
            <span className="font-medium text-fg">{REQUIREMENT_TEMPLATE_LABEL[shown]}.</span>{" "}
            {REQUIREMENT_TEMPLATE_SUMMARY[shown]}{" "}
            <span className="text-fg-subtle">Best for: {REQUIREMENT_TEMPLATE_BEST_FOR[shown]}</span>
          </p>

          {shownFeatures.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {shownFeatures.slice(0, TEMPLATE_CHIP_LIMIT).map((featureKey) => (
                <span
                  key={featureKey}
                  title={templateFeatureTitle(featureKey)}
                  className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-fg-muted"
                >
                  {featureLabel(featureKey)}
                </span>
              ))}
              {shownFeatures.length > TEMPLATE_CHIP_LIMIT && (
                <span className="px-1 text-[11px] text-fg-subtle">
                  +{shownFeatures.length - TEMPLATE_CHIP_LIMIT} more
                </span>
              )}
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={listId}
                onClick={() => setExpandedFor(expanded ? null : shown)}
                className="ml-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-fg-muted transition-colors duration-fast ease-standard hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring motion-reduce:transition-none"
              >
                {expanded ? "Hide full list" : "See everything included"}
                <ChevronDownIcon
                  aria-hidden="true"
                  className={`h-3.5 w-3.5 transition-transform duration-fast ease-standard motion-reduce:transition-none ${
                    expanded ? "rotate-180" : ""
                  }`}
                />
              </button>
            </div>
          )}

          {shownFeatures.length > 0 && (
            <div
              id={listId}
              hidden={!expanded}
              role="region"
              aria-label={`Everything in the ${REQUIREMENT_TEMPLATE_LABEL[shown]} template`}
              tabIndex={expanded ? 0 : -1}
              className="max-h-44 overflow-y-auto rounded-md border border-border bg-surface px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <ul className="grid gap-x-6 gap-y-1.5 @2xl:grid-cols-2">
                {shownFeatures.map((featureKey) => (
                  <li key={featureKey} className="min-w-0">
                    <p className="text-xs font-medium text-fg">{featureLabel(featureKey)}</p>
                    <p className="text-[11px] text-fg-muted">
                      {FEATURE_DESCRIPTION[featureKey]}
                      {TEMPLATE_FEATURE_QUALIFIER[featureKey] && (
                        <span className="text-fg-subtle"> {TEMPLATE_FEATURE_QUALIFIER[featureKey]}</span>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <TemplateEffectLine effect={effect} />
        </div>
      ) : (
        <p className="mt-1.5 text-[11px] text-fg-subtle">Hover or focus a template to preview what it includes.</p>
      )}

      <p className="mt-1 text-[11px] text-fg-subtle">
        Templates choose the requirements for your website plan. They don&apos;t generate a website or connect integrations.
      </p>
    </div>
  );
}

/** One line stating what applying the shown template would do to the
 * current selection — straight from `describeRequirementTemplateEffect`,
 * so it never promises anything `handleApplyTemplate` won't do (applying
 * removes every selected feature outside the template, custom picks
 * included, after the existing confirmation). */
function TemplateEffectLine({ effect }: { effect: ReturnType<typeof describeRequirementTemplateEffect> }) {
  const { toAdd, alreadySelected, toRemove, toRemoveWithNotes } = effect;
  if (toAdd.length === 0 && toRemove.length === 0) {
    return <p className="text-xs text-fg-muted">Already matches your selection — no changes.</p>;
  }
  const parts: string[] = [];
  if (toAdd.length > 0) parts.push(`Adds ${pluralise(toAdd.length, "feature")}`);
  if (alreadySelected.length > 0) parts.push(`${alreadySelected.length} already selected`);
  if (toRemove.length === 0 && alreadySelected.length > 0) parts.push("Keeps your current selections");
  return (
    <p className="text-xs text-fg-muted">
      <span className="font-medium text-fg-subtle">If applied: </span>
      {parts.join(" · ")}
      {toRemove.length > 0 && (
        <>
          {parts.length > 0 && " · "}
          <span className="text-fg">Removes {toRemove.map(featureLabel).join(", ")}</span>
          {toRemoveWithNotes.length > 0 && ` and discards the notes on ${toRemoveWithNotes.map(featureLabel).join(", ")}`}
          {" — you'll be asked to confirm first."}
        </>
      )}
    </p>
  );
}

/** The lightweight inline notes editor for whichever requirement is open
 * — a small expand under the chip grid, not a separate inspector column.
 * Explicit Save/Cancel (no autosave) so "dirty" stays a simple by-
 * comparison check the same way BlueprintInspector's does, which is what
 * lets page.tsx's leave-the-step guard (fed via PlanStep's
 * `onDirtyChange`) reuse that exact discard-confirmation pattern instead
 * of reasoning about in-flight debounced saves.
 *
 * Above the notes, "Already on file" lists what the plan already holds for
 * this feature (see `computeRequirementEvidence`) — read-only, each with a
 * small source label, and never copied into the notes. The one essential
 * question (Contact, when no phone or email is on file) sits there too,
 * linking to the lead record in a new tab so an unsaved notes edit isn't
 * lost. Informational only — nothing here gates progress. */
function NotesEditor({
  requirement,
  evidence,
  leadId,
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
  evidence?: RequirementEvidence;
  leadId: string;
  draft: string;
  dirty: boolean;
  status: SaveStatusValue;
  errorText?: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const known = evidence?.known ?? [];
  const essentialQuestion = evidence?.essentialQuestion ?? null;
  const contentNeeded = evidence?.contentNeeded ?? null;
  const motionNote = evidence?.motionNote ?? null;
  const isCapability = FEATURE_BY_KEY[requirement.feature_key]?.kind === "capability";
  const onFileHeadingId = useId();
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
      <section aria-labelledby={onFileHeadingId} className="space-y-1">
        <p id={onFileHeadingId} className="text-xs font-medium text-fg-muted">
          Already on file
        </p>
        {known.length > 0 ? (
          <ul className="space-y-0.5">
            {known.map((item, i) => (
              <li key={i} className="text-xs text-fg">
                {item.text} <span className="text-fg-subtle">· {item.source}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-fg-subtle">Nothing on file yet — add anything you know in the notes.</p>
        )}
        {isCapability && <p className="text-xs text-fg-muted">Requested — still needs building or connecting.</p>}
        {contentNeeded && (
          <p className="text-xs text-fg-muted">
            <span className="font-medium text-fg">Needs real content:</span> {contentNeeded}
          </p>
        )}
        {motionNote && <p className="text-xs text-fg-subtle">{motionNote}</p>}
        {essentialQuestion && (
          <p className="text-xs text-fg-muted">
            {essentialQuestion}{" "}
            <Link
              href={`/dashboard/leads/${leadId}`}
              // New tab: leaving this page in place keeps any unsaved
              // feature notes (the step guard doesn't cover route changes).
              target="_blank"
              rel="noreferrer"
              className="rounded font-medium text-fg underline decoration-border-strong underline-offset-2 hover:decoration-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              Open lead record ↗<span className="sr-only"> (opens in a new tab)</span>
            </Link>
          </p>
        )}
      </section>
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
