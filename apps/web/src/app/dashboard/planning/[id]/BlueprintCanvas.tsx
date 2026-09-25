"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError, type ContentPage, type ContentSection, type Planning, type SitemapPageProposal } from "@/lib/api";
import {
  clampGapIndex,
  gapToMoveIndex,
  getSectionWireframe,
  reorderSections,
  SECTION_TYPE_LABEL,
  sitemapPagePathLabel,
  type WireframeBlock,
} from "./websiteBlueprintLib";
import { BLUEPRINT_DRAG_MIME, type BlueprintDragPayload } from "./BlueprintLibraryPanel";

const REORDER_MIME = "application/x-blueprint-reorder";

/**
 * Centre pane — the current page, framed as a minimal browser window so
 * it reads as "a webpage" rather than a bare list of boxes. The toolbar
 * (traffic-light dots + a page-label strip) and the header/footer bars
 * are fixed, non-editable, `aria-hidden` chrome — never stored sections
 * (see WebsiteBlueprintSection.tsx's docstring) — framing the page's
 * real, order_index-sorted sections, each drawn as a rough wireframe
 * (grey placeholder shapes, or the section's own already-set
 * heading/draft_text when present — never invented copy).
 *
 * Drop a library item anywhere in the page to add it at that position;
 * drag an existing section to reorder it. Both share one "gap" model —
 * gap 0 is before the first section, gap N (section count) is after the
 * last — so the insertion line the operator sees while dragging is
 * exactly where the drop will land, not just "appended at the end".
 * Every action here also has a keyboard-operable equivalent on the
 * section itself (Move up/down/Remove) — drag is a progressive
 * enhancement, not the only way in.
 */
export function BlueprintCanvas({
  planningId,
  sitemapPage,
  contentPage,
  sections,
  selectedSectionId,
  onSelectSection,
  onUpdated,
}: {
  planningId: string;
  sitemapPage: SitemapPageProposal;
  contentPage: ContentPage | undefined;
  sections: ContentSection[];
  selectedSectionId: string | null;
  onSelectSection: (id: string) => void;
  onUpdated: (p: Planning) => void;
}) {
  const [dragOverGap, setDragOverGap] = useState<number | null>(null);
  const [busySectionId, setBusySectionId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Counts nested dragenter/dragleave pairs across the whole page body so
  // the "dragging over the canvas" tint doesn't flicker off every time
  // the pointer crosses from one child element into another (a plain
  // enter/leave pair per element would do exactly that).
  const dragDepthRef = useRef(0);
  // Disabling a button the instant it's pressed (to block a double
  // submit while its request is in flight) drops keyboard focus to
  // <body> as soon as `disabled` lands, and re-enabling it afterwards
  // doesn't bring focus back on its own. This restores it once
  // `busySectionId` actually clears — the effect only runs after React
  // has committed that re-render (unlike trying it right in the click
  // handler's `finally`, before the button is interactive again) — and
  // only if focus really did get knocked out. Move up/down hand back to
  // the same button; Remove can't (its section, and the button with it,
  // is gone), so it falls back to this list's own container, keeping a
  // keyboard operator's place near the edit they just made instead of
  // dropping them back to the top of the page.
  const bodyRef = useRef<HTMLDivElement>(null);
  const pendingFocusRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (busySectionId !== null) return;
    const trigger = pendingFocusRef.current;
    pendingFocusRef.current = null; // consumed
    if (document.activeElement !== document.body) return;
    if (trigger && trigger.isConnected) trigger.focus();
    else bodyRef.current?.focus();
  }, [busySectionId]);

  function endDrag() {
    dragDepthRef.current = 0;
    setDragOverGap(null);
  }

  async function addFromLibrary(payload: BlueprintDragPayload, targetGap: number) {
    setAdding(true);
    setError(null);
    try {
      const beforeIds = new Set(sections.map((s) => s.id));
      let updated = await api.addBlueprintSection(planningId, sitemapPage.id, payload);
      const afterPage = updated.content_pages.find((p) => p.sitemap_page_id === sitemapPage.id);
      const newSection = afterPage?.sections.find((s) => !beforeIds.has(s.id));
      // The section was just appended at the end server-side. If the
      // operator aimed the drop at an earlier gap, follow up with a
      // reorder so it actually lands where the insertion line showed —
      // otherwise the indicator would be lying to them.
      if (newSection && afterPage) {
        const sortedAfter = [...afterPage.sections].sort((a, b) => a.order_index - b.order_index);
        const fromIndex = sortedAfter.findIndex((s) => s.id === newSection.id);
        const toIndex = clampGapIndex(targetGap, sortedAfter.length - 1);
        if (fromIndex !== -1 && fromIndex !== toIndex) {
          updated = await api.reorderContentSections(planningId, afterPage.id, {
            sections: reorderSections(sortedAfter, fromIndex, toIndex),
          });
        }
      }
      onUpdated(updated);
      if (newSection) onSelectSection(newSection.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add that section.");
    } finally {
      setAdding(false);
    }
  }

  async function moveTo(sectionId: string, toIndex: number, trigger: HTMLButtonElement | null = null) {
    if (!contentPage) return;
    const fromIndex = sections.findIndex((s) => s.id === sectionId);
    if (fromIndex === -1 || fromIndex === toIndex) return;
    setBusySectionId(sectionId);
    setError(null);
    pendingFocusRef.current = trigger;
    try {
      onUpdated(await api.reorderContentSections(planningId, contentPage.id, { sections: reorderSections(sections, fromIndex, toIndex) }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reorder sections.");
    } finally {
      setBusySectionId(null);
    }
  }

  async function move(sectionId: string, delta: number, trigger: HTMLButtonElement | null) {
    const index = sections.findIndex((s) => s.id === sectionId);
    if (index === -1) return;
    await moveTo(sectionId, index + delta, trigger);
  }

  async function handleRemove(sectionId: string) {
    if (!contentPage) return;
    setBusySectionId(sectionId);
    setError(null);
    // The removed section's own Remove button is gone with it, so
    // there's nothing to hand focus back to — the effect above falls
    // back to the list container instead of letting focus fall through
    // to <body>.
    pendingFocusRef.current = null;
    try {
      onUpdated(await api.deleteContentSection(planningId, contentPage.id, sectionId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't remove that section.");
    } finally {
      setBusySectionId(null);
    }
  }

  function readLibraryPayload(e: React.DragEvent): BlueprintDragPayload | null {
    const raw = e.dataTransfer.getData(BLUEPRINT_DRAG_MIME);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as BlueprintDragPayload;
    } catch {
      return null;
    }
  }

  function handleGapDrop(e: React.DragEvent, gapIndex: number) {
    e.preventDefault();
    e.stopPropagation();
    endDrag();
    const gap = clampGapIndex(gapIndex, sections.length);
    const reorderId = e.dataTransfer.getData(REORDER_MIME);
    if (reorderId) {
      const fromIndex = sections.findIndex((s) => s.id === reorderId);
      if (fromIndex !== -1) moveTo(reorderId, gapToMoveIndex(gap, fromIndex));
      return;
    }
    const payload = readLibraryPayload(e);
    if (payload) addFromLibrary(payload, gap);
  }

  /** Reads which side of a section row the pointer is on, so hovering
   * its top half previews "insert before" and its bottom half previews
   * "insert after" — the fine-grained half of the gap model; the coarse
   * half (an explicit gap after the whole list) is handled where it's
   * rendered, below. */
  function rowGapIndex(e: React.DragEvent, index: number): number {
    const rect = e.currentTarget.getBoundingClientRect();
    return e.clientY < rect.top + rect.height / 2 ? index : index + 1;
  }

  return (
    <div className="space-y-2">
      {/* The browser-chrome frame itself — border/shadow/radius tokens
          already in globals.css, no live iframe and no reference image:
          just enough decoration to read as "a webpage", not as this
          app's own UI. */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        {/* Toolbar — pure decoration. Nothing here is a real control: no
            <button>s, no hover affordance, and the whole strip is
            aria-hidden so assistive tech never announces it as
            interactive chrome. */}
        <div className="flex items-center gap-3 border-b border-border bg-surface-subtle px-3 py-2" aria-hidden="true">
          <div className="flex shrink-0 gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
            <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
            <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
          </div>
          <div className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface px-3 py-1 text-center text-[11px] text-fg-subtle">
            {sitemapPagePathLabel(sitemapPage)}
          </div>
        </div>

        {/* Fixed chrome — not a stored section on any page (see the
            module docstring). */}
        <div
          className="border-b border-border bg-surface-subtle px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-fg-subtle"
          aria-hidden="true"
        >
          Header · site-wide navigation
        </div>

        <div
          ref={bodyRef}
          tabIndex={-1}
          className={`min-h-[420px] space-y-2 bg-surface p-4 transition-colors duration-fast ease-standard focus:outline-none motion-reduce:transition-none ${
            dragOverGap !== null ? "bg-accent-soft" : ""
          }`}
          onDragEnter={(e) => {
            e.preventDefault();
            dragDepthRef.current += 1;
          }}
          onDragOver={(e) => {
            e.preventDefault();
            // Only the whole-body fallback ("append at the end") — a row
            // hovered directly overrides this via stopPropagation below.
            if (sections.length > 0) setDragOverGap(sections.length);
          }}
          onDragLeave={() => {
            dragDepthRef.current -= 1;
            if (dragDepthRef.current <= 0) endDrag();
          }}
          onDrop={(e) => handleGapDrop(e, sections.length)}
        >
          {sections.length === 0 ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragOverGap(0);
              }}
              onDrop={(e) => handleGapDrop(e, 0)}
              className={`flex min-h-[340px] items-center justify-center rounded-lg border-2 border-dashed transition-colors duration-fast ease-standard motion-reduce:transition-none ${
                dragOverGap === 0 ? "border-fg bg-accent-soft" : "border-border"
              }`}
            >
              {adding && <span className="text-xs text-fg-subtle">Adding…</span>}
            </div>
          ) : (
            <>
              {sections.map((section, index) => (
                <div key={section.id}>
                  <GapIndicator active={dragOverGap === index} />
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDragOverGap(rowGapIndex(e, index));
                    }}
                    onDrop={(e) => handleGapDrop(e, rowGapIndex(e, index))}
                  >
                    <SectionBlock
                      section={section}
                      index={index}
                      total={sections.length}
                      selected={section.id === selectedSectionId}
                      busy={busySectionId === section.id}
                      onSelect={() => onSelectSection(section.id)}
                      onMoveUp={(trigger) => move(section.id, -1, trigger)}
                      onMoveDown={(trigger) => move(section.id, 1, trigger)}
                      onRemove={() => handleRemove(section.id)}
                    />
                  </div>
                </div>
              ))}
              <GapIndicator active={dragOverGap === sections.length} />
            </>
          )}
        </div>

        <div
          className="border-t border-border bg-surface-subtle px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-fg-subtle"
          aria-hidden="true"
        >
          Footer · site-wide navigation
        </div>

        {error && <p className="border-t border-border px-3 py-2 text-error">{error}</p>}
      </div>

      {/* The drag/empty-state hint lives here, outside the white page
          area, so the page itself always looks genuinely blank rather
          than carrying floating instructional text. */}
      <p className="text-center text-[11px] text-fg-subtle">
        {sections.length === 0
          ? "Blueprint preview, not the live site — drag a section from the library into the page to start."
          : "Blueprint preview — a planning wireframe, not the live site."}
      </p>
    </div>
  );
}

function GapIndicator({ active }: { active: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`my-1 h-1 rounded-full transition-colors duration-fast ease-standard motion-reduce:transition-none ${
        active ? "bg-fg" : "bg-transparent"
      }`}
    />
  );
}

function SectionBlock({
  section,
  index,
  total,
  selected,
  busy,
  onSelect,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  section: ContentSection;
  index: number;
  total: number;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onMoveUp: (trigger: HTMLButtonElement) => void;
  onMoveDown: (trigger: HTMLButtonElement) => void;
  onRemove: () => void;
}) {
  const label = SECTION_TYPE_LABEL[section.section_type] ?? section.section_type;
  return (
    <div
      draggable
      // Chrome puts any `[draggable]` element into the tab sequence by
      // default, even with no keyboard drag behavior of its own — this
      // would add a dead stop to every section box on the way to its
      // actual Select/Move/Remove controls below. tabIndex={-1} keeps
      // dragging (a progressive enhancement) while leaving the real
      // keyboard path to those explicit buttons.
      tabIndex={-1}
      onDragStart={(e) => {
        e.dataTransfer.setData(REORDER_MIME, section.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={`group relative cursor-grab rounded-md border-2 p-3 transition-colors duration-fast ease-standard active:cursor-grabbing motion-reduce:transition-none ${
        selected ? "border-fg bg-surface-hover" : "border-border bg-surface hover:border-border-strong"
      } ${busy ? "opacity-60" : ""}`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="block w-full rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">{label}</span>
          {section.source_recommendation_id && <span className="text-[10px] font-medium text-fg-subtle">Suggested</span>}
        </div>
        <SectionWireframe section={section} />
      </button>
      {/* Editing controls stay subtle by default — visible on hover,
          selection, or keyboard focus inside the card, not permanently
          on every section (a keyboard operator still reaches them via
          Tab regardless of visibility). */}
      <div
        className={`mt-2 flex items-center gap-0.5 border-t border-border pt-2 transition-opacity duration-fast ease-standard motion-reduce:transition-none ${
          selected ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
        }`}
      >
        <button
          type="button"
          onClick={(e) => onMoveUp(e.currentTarget)}
          disabled={index === 0 || busy}
          aria-label={`Move "${section.heading || label}" up`}
          className="rounded p-2 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-30"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={(e) => onMoveDown(e.currentTarget)}
          disabled={index === total - 1 || busy}
          aria-label={`Move "${section.heading || label}" down`}
          className="rounded p-2 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-30"
        >
          ↓
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          aria-label={`Remove "${section.heading || label}"`}
          className="ml-auto rounded px-2 py-2 text-xs font-medium text-fg-subtle hover:bg-surface-hover hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-30"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

/** Renders a section's rough wireframe — grey placeholder shapes, or the
 * section's own already-set heading/draft_text where present. Purely
 * illustrative (the shapes carry no semantics of their own), so it's
 * marked aria-hidden; the real accessible label is the button wrapping
 * it, above. */
function SectionWireframe({ section }: { section: ContentSection }) {
  const blocks = getSectionWireframe(section.section_type);
  // Every layout in SECTION_WIREFRAME has at most one "heading" and one
  // "subtext" block, but that's just how the current data happens to be
  // shaped — find the first index of each rather than assuming it, so a
  // future layout with two of either still only substitutes real copy
  // in once.
  const firstHeadingIndex = blocks.findIndex((b) => b.role === "heading");
  const firstSubtextIndex = blocks.findIndex((b) => b.role === "subtext");
  return (
    <div className="space-y-2" aria-hidden="true">
      {blocks.map((block, i) => {
        if (block.role === "heading" && i === firstHeadingIndex) {
          return section.heading ? (
            <p key={i} className="truncate text-sm font-semibold text-fg">
              {section.heading}
            </p>
          ) : (
            <div key={i} className="h-4 w-2/3 rounded bg-fg-subtle/25" />
          );
        }
        if (block.role === "subtext" && i === firstSubtextIndex && section.draft_text) {
          return (
            <p key={i} className="line-clamp-2 text-xs text-fg-subtle">
              {section.draft_text}
            </p>
          );
        }
        return <WireframeBlockShape key={i} block={block} />;
      })}
    </div>
  );
}

function WireframeBlockShape({ block }: { block: WireframeBlock }) {
  switch (block.role) {
    case "heading":
      return <div className="h-4 w-2/3 rounded bg-fg-subtle/25" />;
    case "subtext": {
      const widths = ["w-full", "w-5/6", "w-2/3"];
      return (
        <div className="space-y-1.5">
          {Array.from({ length: block.count ?? 1 }).map((_, i) => (
            <div key={i} className={`h-2 rounded-full bg-fg-subtle/20 ${widths[i % widths.length]}`} />
          ))}
        </div>
      );
    }
    case "media":
      return <div className="h-16 w-full rounded-md bg-fg-subtle/15" />;
    case "cta":
      return <div className="h-6 w-24 rounded-md bg-fg-subtle/30" />;
    case "field":
      return (
        <div className="space-y-1.5">
          {Array.from({ length: block.count ?? 1 }).map((_, i) => (
            <div key={i} className="h-6 w-full rounded-md border border-border-strong bg-surface" />
          ))}
        </div>
      );
    case "list":
      return (
        <div className="space-y-2">
          {Array.from({ length: block.count ?? 1 }).map((_, i) => (
            <div key={i} className="space-y-1">
              <div className="h-2.5 w-1/3 rounded-full bg-fg-subtle/25" />
              <div className="h-2 w-5/6 rounded-full bg-fg-subtle/15" />
            </div>
          ))}
        </div>
      );
    case "grid": {
      const count = block.count ?? 3;
      return (
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: count }).map((_, i) =>
            block.variant === "images" ? (
              <div key={i} className="aspect-square rounded-md bg-fg-subtle/15" />
            ) : (
              <div key={i} className="space-y-1.5 rounded-md border border-border p-1.5">
                <div className="h-6 w-6 rounded bg-fg-subtle/25" />
                <div className="h-1.5 w-full rounded-full bg-fg-subtle/20" />
                <div className="h-1.5 w-2/3 rounded-full bg-fg-subtle/15" />
              </div>
            ),
          )}
        </div>
      );
    }
    default:
      return null;
  }
}
