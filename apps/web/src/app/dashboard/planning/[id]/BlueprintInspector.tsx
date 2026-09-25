"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError, type ContentSection, type Planning } from "@/lib/api";
import { SaveStatus, type SaveStatusValue } from "@/components/ui/SaveStatus";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { SECTION_TYPE_LABEL } from "./websiteBlueprintLib";

type Fields = { heading: string; purpose: string; draft_text: string; notes: string };

function fieldsOf(section: ContentSection): Fields {
  return {
    heading: section.heading ?? "",
    purpose: section.purpose ?? "",
    draft_text: section.draft_text ?? "",
    notes: section.notes ?? "",
  };
}

/**
 * Right pane — only rendered by the parent while a canvas section is
 * selected (see WebsiteBlueprintSection.tsx); with nothing selected, that
 * column simply doesn't exist, so the canvas gets its full width back
 * instead of it sitting empty. Edits the selected section's light,
 * type-agnostic Blueprint fields (heading/purpose/draft_text/notes) via
 * `updateContentSection`. Content Draft's own richer, type-specific
 * `content` dict is a separate editor (ContentSectionEditor) and is never
 * sent from here.
 *
 * The parent renders this with `key={section.id}`, so selecting a
 * different section remounts it fresh with that section's own values —
 * the standard React way to reset local editable state on an identity
 * change, instead of a `useEffect` that would `setState` synchronously on
 * every render where the id changed. Saving itself stays a plain
 * `await api.updateContentSection(...)` call, not tied to this
 * component's lifecycle: if the operator closes or switches sections
 * while a save is in flight, the request still completes and its
 * `onUpdated` still lands, because it's a bare promise/callback, not
 * component state — closing never aborts or loses an in-flight save.
 *
 * There is no autosave here (a manual "Save" button, unchanged by this
 * task) — so switching away with unsaved edits IS a real way to lose
 * them. `onDirtyChange` reports that risk up to the parent, which is what
 * gates a confirm dialog before a selection change that would discard
 * them (see `requestSelectSection`/`confirmDiscardIfDirty` there).
 */
export function BlueprintInspector({
  planningId,
  contentPageId,
  section,
  onUpdated,
  onClose,
  onDirtyChange,
  onStatusChange,
}: {
  planningId: string;
  contentPageId: string | null;
  section: ContentSection;
  onUpdated: (p: Planning) => void;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  /** Mirrors this inspector's own `displayStatus` up to the parent —
   * purely so the Blueprint toolbar's SaveStatus readout can show the
   * same thing this panel shows, without becoming a second source of
   * truth for the discard guard (that stays `onDirtyChange`, above). */
  onStatusChange?: (status: SaveStatusValue) => void;
}) {
  const [fields, setFields] = useState<Fields>(() => fieldsOf(section));
  const [saved, setSaved] = useState<Fields>(() => fieldsOf(section));
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorText, setErrorText] = useState<string | undefined>();

  const dirty = (Object.keys(fields) as (keyof Fields)[]).some((k) => fields[k] !== saved[k]);
  const displayStatus: SaveStatusValue = status === "saving" ? "saving" : status === "error" ? "error" : dirty ? "dirty" : status === "saved" ? "saved" : "idle";

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    onStatusChange?.(displayStatus);
  }, [displayStatus, onStatusChange]);

  // Opening the inspector moves focus onto its own title — the operator
  // just took an action (selected a section, or added one) that opened
  // this panel, so focus should land somewhere inside it rather than
  // staying wherever it happened to be. `preventScroll` keeps that from
  // dragging the library panel's or canvas's own scroll position along
  // with it.
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // Only on mount of this section's own instance (the parent remounts
    // this component via `key={section.id}` on every selection change).
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  function set(field: keyof Fields, value: string) {
    setFields((f) => ({ ...f, [field]: value }));
    if (status !== "saving") setStatus("idle");
  }

  async function handleSave() {
    setStatus("saving");
    setErrorText(undefined);
    try {
      const updated = await api.updateContentSection(planningId, contentPageId as string, section.id, {
        heading: fields.heading.trim() || null,
        purpose: fields.purpose.trim() || null,
        draft_text: fields.draft_text.trim() || null,
        notes: fields.notes.trim() || null,
      });
      onUpdated(updated);
      setSaved(fields);
      setStatus("saved");
    } catch (err) {
      setErrorText(err instanceof ApiError ? err.message : "Couldn't save this section.");
      setStatus("error");
    }
  }

  return (
    // Escape closes the inspector, but only because this handler is local
    // to the panel itself (it only ever fires while focus is genuinely
    // inside it) — never a document-level listener, which could steal
    // Escape from an unrelated field the operator is actively typing in
    // elsewhere (e.g. the canvas or library panel). Closing only clears
    // the selection (`onClose`) — it never deletes the section or
    // resets/discards anything already saved to it.
    <div className="card space-y-3 p-3" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Editing section</p>
          <h3
            ref={titleRef}
            tabIndex={-1}
            // A plain `:focus` ring, not `:focus-visible` — this element is
            // only ever focused programmatically (never by a stray mouse
            // click in normal use), so the ring should always confirm where
            // focus just landed rather than depend on the browser's
            // keyboard-vs-pointer heuristic.
            className="truncate rounded text-sm font-semibold text-fg outline-none focus:ring-2 focus:ring-focus-ring"
          >
            {SECTION_TYPE_LABEL[section.section_type] ?? section.section_type}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="shrink-0 rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path d="M4.22 4.22a.75.75 0 0 1 1.06 0L10 8.94l4.72-4.72a.75.75 0 1 1 1.06 1.06L11.06 10l4.72 4.72a.75.75 0 1 1-1.06 1.06L10 11.06l-4.72 4.72a.75.75 0 0 1-1.06-1.06L8.94 10 4.22 5.28a.75.75 0 0 1 0-1.06Z" />
          </svg>
        </button>
      </div>

      <div className="space-y-1">
        <label htmlFor="bp-inspector-heading" className="field-label text-xs">
          Heading
        </label>
        <Input id="bp-inspector-heading" value={fields.heading} onChange={(e) => set("heading", e.target.value)} className="input" />
      </div>
      <div className="space-y-1">
        <label htmlFor="bp-inspector-purpose" className="field-label text-xs">
          Purpose
        </label>
        <Textarea
          id="bp-inspector-purpose"
          value={fields.purpose}
          onChange={(e) => set("purpose", e.target.value)}
          rows={2}
          className="input"
          placeholder="What this section is for"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="bp-inspector-draft" className="field-label text-xs">
          Draft text
        </label>
        <Textarea
          id="bp-inspector-draft"
          value={fields.draft_text}
          onChange={(e) => set("draft_text", e.target.value)}
          rows={3}
          className="input"
          placeholder="Rough copy for this section"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="bp-inspector-notes" className="field-label text-xs">
          Notes
        </label>
        <Textarea id="bp-inspector-notes" value={fields.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className="input" />
      </div>

      <div className="flex items-center gap-2 border-t border-border pt-2">
        <button type="button" onClick={handleSave} disabled={!dirty || status === "saving"} className="btn btn-secondary btn-sm">
          {status === "saving" ? "Saving…" : "Save"}
        </button>
        <SaveStatus status={displayStatus} errorText={errorText} />
      </div>
    </div>
  );
}
