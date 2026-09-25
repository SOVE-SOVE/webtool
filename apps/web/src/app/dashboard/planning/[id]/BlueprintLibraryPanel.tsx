"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError, CONTENT_SECTION_TYPES, type ContentSectionType, type Planning } from "@/lib/api";
import {
  deriveRecommendedSections,
  getSectionWireframe,
  SECTION_TYPE_DESCRIPTION,
  SECTION_TYPE_LABEL,
  type WireframeBlock,
} from "./websiteBlueprintLib";

export const BLUEPRINT_DRAG_MIME = "application/x-blueprint-section";

export type BlueprintDragPayload = {
  section_type: string;
  heading?: string | null;
  purpose?: string | null;
  source_recommendation_id?: string | null;
};

type LibraryTab = "recommended" | "all";

/**
 * Left pane of the Website Blueprint editor — the section library, as two
 * views over the exact same underlying add behaviour: "Recommended"
 * (derived from the plan's own accepted "Add" recommendations, mapped to a
 * section type — see `deriveRecommendedSections`) and "All sections" (the
 * complete standard library). Every card in either view is addable by
 * click (fully keyboard-operable) and also draggable onto the canvas as a
 * progressive enhancement, using native HTML5 drag events (this repo has
 * no drag-and-drop dependency installed, and the keyboard path has to
 * exist regardless) — both views call the same `addSection`/
 * `handleDragStart`, so neither forks the add logic.
 */
export function BlueprintLibraryPanel({
  planning,
  sitemapPageId,
  onUpdated,
  onAdded,
}: {
  planning: Planning;
  sitemapPageId: string;
  onUpdated: (p: Planning) => void;
  onAdded: (sectionId: string) => void;
}) {
  const recommended = deriveRecommendedSections(planning);
  // Lazy initializer only — land on "Recommended" when it actually has
  // something to show, "All sections" otherwise, but never flip the tab
  // out from under the operator later just because `planning` changed
  // (e.g. after they add a card, or a recommendation's status changes
  // elsewhere).
  const [tab, setTab] = useState<LibraryTab>(() => (recommended.length > 0 ? "recommended" : "all"));
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Disabling the just-activated button mid-request (to block a
  // double-submit) drops keyboard focus to <body> the instant the
  // `disabled` attribute lands, and re-enabling it doesn't bring focus
  // back on its own — so a keyboard operator loses their place after
  // every add. This restores it, once the button is actually
  // interactive again (the effect only runs after React has committed
  // that re-render, unlike trying it right in the click handler's
  // `finally`) and only if focus really did get knocked out.
  const pendingFocusRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (addingKey !== null) return;
    const trigger = pendingFocusRef.current;
    pendingFocusRef.current = null;
    if (trigger && trigger.isConnected && document.activeElement === document.body) trigger.focus();
  }, [addingKey]);

  async function addSection(key: string, payload: BlueprintDragPayload, trigger: HTMLButtonElement | null) {
    setAddingKey(key);
    setError(null);
    pendingFocusRef.current = trigger;
    try {
      const before = planning.content_pages.find((p) => p.sitemap_page_id === sitemapPageId);
      const beforeIds = new Set(before?.sections.map((s) => s.id) ?? []);
      const updated = await api.addBlueprintSection(planning.id, sitemapPageId, payload);
      onUpdated(updated);
      const after = updated.content_pages.find((p) => p.sitemap_page_id === sitemapPageId);
      const newSection = after?.sections.find((s) => !beforeIds.has(s.id));
      if (newSection) onAdded(newSection.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add that section.");
    } finally {
      setAddingKey(null);
    }
  }

  function handleDragStart(e: React.DragEvent, payload: BlueprintDragPayload) {
    e.dataTransfer.setData(BLUEPRINT_DRAG_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "copy";
  }

  return (
    <div className="card space-y-3 p-3">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Section library</h3>
        <div role="tablist" aria-label="Section library view" className="mt-2 flex gap-1 rounded-md bg-surface-subtle p-0.5">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "recommended"}
            onClick={() => setTab("recommended")}
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
            onClick={() => setTab("all")}
            className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring motion-reduce:transition-none ${
              tab === "all" ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg"
            }`}
          >
            All sections
          </button>
        </div>
      </div>

      {/* Its own scrollbar once the list outgrows the space the canvas
          gives it — this must never force the whole page (or the
          canvas next to it) to scroll just to reach a lower card. */}
      <div className="max-h-[min(70vh,32rem)] overflow-y-auto pr-0.5">
        {tab === "recommended" ? (
          recommended.length > 0 ? (
            <ul className="space-y-2">
              {recommended.map((item) => {
                const key = `rec:${item.sectionType}`;
                const payload: BlueprintDragPayload = {
                  section_type: item.sectionType,
                  heading: item.primary.title,
                  purpose: item.primary.explanation,
                  source_recommendation_id: item.primary.id,
                };
                return (
                  <li key={item.sectionType}>
                    <SectionCard
                      sectionType={item.sectionType}
                      description={item.reason}
                      payload={payload}
                      addKey={key}
                      adding={addingKey !== null}
                      isAdding={addingKey === key}
                      onDragStart={handleDragStart}
                      onAdd={(trigger) => addSection(key, payload, trigger)}
                    />
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="rounded-md border border-dashed border-border p-3 text-center">
              <p className="text-xs text-fg-subtle">
                {planning.recommendations.some((r) => r.status === "accepted" && r.category === "add")
                  ? "None of the accepted recommendations match a website section — they may belong in the Build Brief instead."
                  : "No accepted recommendations yet. Accept an “Add” recommendation in Build Brief to see it suggested here."}
              </p>
              <button type="button" onClick={() => setTab("all")} className="btn btn-secondary btn-sm mt-2">
                Browse all sections
              </button>
            </div>
          )
        ) : (
          <ul className="space-y-2">
            {CONTENT_SECTION_TYPES.map((type) => {
              const payload: BlueprintDragPayload = { section_type: type };
              return (
                <li key={type}>
                  <SectionCard
                    sectionType={type}
                    description={SECTION_TYPE_DESCRIPTION[type]}
                    payload={payload}
                    addKey={type}
                    adding={addingKey !== null}
                    isAdding={addingKey === type}
                    onDragStart={handleDragStart}
                    onAdd={(trigger) => addSection(type, payload, trigger)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {error && <p className="text-error">{error}</p>}
    </div>
  );
}

/** One section-library card, shared by both the "Recommended" and "All
 * sections" views — a miniature wireframe thumbnail (the same shape data
 * driving the canvas, see `getSectionWireframe`, at thumbnail scale) plus
 * the section's name and a short description/reason. Both add paths
 * (native HTML5 drag onto the canvas, and the "+ Add" button) are wired to
 * the exact same handlers the caller passes in. */
function SectionCard({
  sectionType,
  description,
  payload,
  addKey,
  adding,
  isAdding,
  onDragStart,
  onAdd,
}: {
  sectionType: ContentSectionType;
  description: string;
  payload: BlueprintDragPayload;
  addKey: string;
  adding: boolean;
  isAdding: boolean;
  onDragStart: (e: React.DragEvent, payload: BlueprintDragPayload) => void;
  onAdd: (trigger: HTMLButtonElement | null) => void;
}) {
  return (
    <div
      draggable
      // See BlueprintCanvas's SectionBlock for why this needs
      // tabIndex={-1}: Chrome tab-stops any [draggable] element by
      // default, which would add a dead stop before the real "+ Add"
      // button right after it.
      tabIndex={-1}
      onDragStart={(e) => onDragStart(e, payload)}
      className="cursor-grab rounded-md border border-border bg-surface p-2 active:cursor-grabbing"
    >
      <SectionThumbnail sectionType={sectionType} />
      <p className="mt-1.5 text-xs font-medium text-fg">{SECTION_TYPE_LABEL[sectionType] ?? sectionType}</p>
      <p className="mt-0.5 line-clamp-2 text-[11px] text-fg-subtle">{description}</p>
      <button
        type="button"
        onClick={(e) => onAdd(e.currentTarget)}
        disabled={adding}
        aria-label={`Add ${SECTION_TYPE_LABEL[sectionType] ?? sectionType} section`}
        className="btn btn-secondary btn-sm mt-2 w-full disabled:opacity-50"
        data-key={addKey}
      >
        {isAdding ? "Adding…" : "+ Add"}
      </button>
    </div>
  );
}

/** A small, purely decorative wireframe preview built from the exact same
 * `getSectionWireframe` shape data as the canvas's own section wireframes
 * (see BlueprintCanvas's SectionWireframe) — scaled down and simplified for
 * card size, never a second wireframe-shape system. Neutral grey/blank
 * placeholder shapes only; never real or invented business copy. */
function SectionThumbnail({ sectionType }: { sectionType: string }) {
  const blocks = getSectionWireframe(sectionType);
  return (
    <div aria-hidden="true" className="space-y-1 rounded-sm border border-border bg-surface-subtle p-1.5">
      {blocks.map((block, i) => (
        <ThumbnailBlock key={i} block={block} />
      ))}
    </div>
  );
}

function ThumbnailBlock({ block }: { block: WireframeBlock }) {
  switch (block.role) {
    case "heading":
      return <div className="h-1.5 w-2/3 rounded-full bg-fg-subtle/40" />;
    case "subtext": {
      const widths = ["w-full", "w-5/6", "w-2/3"];
      return (
        <div className="space-y-0.5">
          {Array.from({ length: Math.min(block.count ?? 1, 2) }).map((_, i) => (
            <div key={i} className={`h-1 rounded-full bg-fg-subtle/25 ${widths[i % widths.length]}`} />
          ))}
        </div>
      );
    }
    case "media":
      return <div className="h-5 w-full rounded-sm bg-fg-subtle/20" />;
    case "cta":
      return <div className="h-1.5 w-6 rounded-full bg-fg-subtle/35" />;
    case "field":
      return (
        <div className="space-y-0.5">
          {Array.from({ length: Math.min(block.count ?? 1, 3) }).map((_, i) => (
            <div key={i} className="h-1.5 w-full rounded-sm border border-border-strong/70 bg-surface" />
          ))}
        </div>
      );
    case "list":
      return (
        <div className="space-y-1">
          {Array.from({ length: Math.min(block.count ?? 1, 3) }).map((_, i) => (
            <div key={i} className="h-1 w-5/6 rounded-full bg-fg-subtle/20" />
          ))}
        </div>
      );
    case "grid": {
      const count = Math.min(block.count ?? 3, 4);
      return (
        <div className="grid grid-cols-4 gap-0.5">
          {Array.from({ length: count }).map((_, i) =>
            block.variant === "images" ? (
              <div key={i} className="aspect-square rounded-sm bg-fg-subtle/20" />
            ) : (
              <div key={i} className="aspect-square rounded-sm border border-border/70 bg-fg-subtle/10" />
            ),
          )}
        </div>
      );
    }
    default:
      return null;
  }
}
