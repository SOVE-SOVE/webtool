"use client";

import { useState } from "react";
import { api, ApiError, type ContentSection, type Planning } from "@/lib/api";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";

const SECTION_TYPE_LABEL: Record<string, string> = {
  hero: "Homepage headline",
  about: "About",
  serviceCards: "Services",
  gallery: "Gallery introduction",
  contact: "Contact & booking",
  cta: "Call to action",
  faq: "FAQs",
};

const inputClass = "w-full rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm";
const textareaClass = `${inputClass}`;

type Draft = Record<string, unknown>;

function ServiceRows({ services, onChange }: { services: { title: string; description: string }[]; onChange: (v: { title: string; description: string }[]) => void }) {
  return (
    <div className="space-y-2">
      {services.map((s, i) => (
        <div key={i} className="flex gap-2">
          <Input
            value={s.title}
            placeholder="Service title"
            onChange={(e) => onChange(services.map((row, j) => (j === i ? { ...row, title: e.target.value } : row)))}
            className={`${inputClass} flex-1`}
          />
          <Input
            value={s.description}
            placeholder="Description"
            onChange={(e) => onChange(services.map((row, j) => (j === i ? { ...row, description: e.target.value } : row)))}
            className={`${inputClass} flex-[2]`}
          />
          <button type="button" onClick={() => onChange(services.filter((_, j) => j !== i))} className="text-xs text-fg-subtle hover:underline">
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...services, { title: "", description: "" }])} className="text-xs font-medium text-fg-muted hover:underline">
        + Add service
      </button>
    </div>
  );
}

function FaqRows({ items, onChange }: { items: { question: string; answer: string }[]; onChange: (v: { question: string; answer: string }[]) => void }) {
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="space-y-1 rounded-md border border-border p-2">
          <Input
            value={item.question}
            placeholder="Question"
            onChange={(e) => onChange(items.map((row, j) => (j === i ? { ...row, question: e.target.value } : row)))}
            className={`${inputClass} font-medium`}
          />
          <Textarea
            value={item.answer}
            placeholder="Confirmed answer"
            rows={2}
            onChange={(e) => onChange(items.map((row, j) => (j === i ? { ...row, answer: e.target.value } : row)))}
            className={textareaClass}
          />
          <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-xs text-fg-subtle hover:underline">
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, { question: "", answer: "" }])} className="text-xs font-medium text-fg-muted hover:underline">
        + Add FAQ
      </button>
    </div>
  );
}

function ContactDetailRows({ details, onChange }: { details: { label: string; value: string }[]; onChange: (v: { label: string; value: string }[]) => void }) {
  return (
    <div className="space-y-2">
      {details.map((d, i) => (
        <div key={i} className="flex gap-2">
          <Input
            value={d.label}
            placeholder="Label (e.g. Phone)"
            onChange={(e) => onChange(details.map((row, j) => (j === i ? { ...row, label: e.target.value } : row)))}
            className={`${inputClass} flex-1`}
          />
          <Input
            value={d.value}
            placeholder="Value"
            onChange={(e) => onChange(details.map((row, j) => (j === i ? { ...row, value: e.target.value } : row)))}
            className={`${inputClass} flex-[2]`}
          />
          <button type="button" onClick={() => onChange(details.filter((_, j) => j !== i))} className="text-xs text-fg-subtle hover:underline">
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...details, { label: "", value: "" }])} className="text-xs font-medium text-fg-muted hover:underline">
        + Add detail
      </button>
    </div>
  );
}

/** Renders and edits one Content Draft section's fields, switching by
 * `section_type` — each shape matches the real packages/site-templates
 * config exactly (see agents/planning_content_draft.py). One explicit
 * "Save" per section, with a visible dirty/saving/saved status and a
 * "Regenerate" action that either replaces immediately or shows a
 * preview to apply, per service.regenerate_content_section's rules. */
export function ContentSectionEditor({
  planningId,
  pageId,
  section,
  pageApproved,
  onUpdated,
}: {
  planningId: string;
  pageId: string;
  section: ContentSection;
  pageApproved: boolean;
  onUpdated: (p: Planning) => void;
}) {
  const [draft, setDraft] = useState<Draft>(section.content);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ content: Draft; notes: string[] } | null>(null);

  function set(field: string, value: unknown) {
    setDraft((d) => ({ ...d, [field]: value }));
    setDirty(true);
    setStatus("idle");
  }

  async function handleSave() {
    setStatus("saving");
    setError(null);
    try {
      onUpdated(await api.updateContentSection(planningId, pageId, section.id, { content: draft }));
      setDirty(false);
      setStatus("saved");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save this section.");
      setStatus("idle");
    }
  }

  async function handleRegenerate() {
    setRegenerating(true);
    setError(null);
    try {
      const result = await api.regenerateContentSection(planningId, pageId, section.id);
      if (result.is_preview && result.preview) {
        setPreview({ content: result.preview.candidate_content, notes: result.preview.candidate_needs_confirmation_notes });
      } else if (result.planning) {
        onUpdated(result.planning);
        const freshPage = result.planning.content_pages.find((p) => p.id === pageId);
        const freshSection = freshPage?.sections.find((s) => s.id === section.id);
        if (freshSection) {
          setDraft(freshSection.content);
          setDirty(false);
        }
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't regenerate this section.");
    } finally {
      setRegenerating(false);
    }
  }

  async function handleApplyPreview() {
    if (!preview) return;
    setError(null);
    try {
      const updated = await api.applyContentSectionPreview(planningId, pageId, section.id, {
        content: preview.content,
        needs_confirmation_notes: preview.notes,
      });
      onUpdated(updated);
      setDraft(preview.content);
      setDirty(false);
      setPreview(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't apply the regenerated content.");
    }
  }

  const fields = (() => {
    switch (section.section_type) {
      case "hero":
      case "gallery":
        return (
          <div className="space-y-2">
            <Input
              value={(draft.heading as string) ?? ""}
              placeholder="Heading"
              onChange={(e) => set("heading", e.target.value)}
              className={`${inputClass} font-medium`}
            />
            <Textarea
              value={(draft.subheading as string) ?? ""}
              placeholder="Subheading"
              rows={2}
              onChange={(e) => set("subheading", e.target.value)}
              className={textareaClass}
            />
          </div>
        );
      case "about":
        return (
          <Textarea
            value={(draft.body as string) ?? ""}
            placeholder="About paragraph"
            rows={4}
            onChange={(e) => set("body", e.target.value)}
            className={textareaClass}
          />
        );
      case "serviceCards":
        return (
          <ServiceRows
            services={(draft.services as { title: string; description: string }[]) ?? []}
            onChange={(v) => set("services", v)}
          />
        );
      case "contact":
        return (
          <div className="space-y-2">
            <ContactDetailRows
              details={(draft.details as { label: string; value: string }[]) ?? []}
              onChange={(v) => set("details", v)}
            />
            <Textarea
              value={(draft.booking_instructions as string) ?? ""}
              placeholder="Booking instructions (optional)"
              rows={2}
              onChange={(e) => set("booking_instructions", e.target.value)}
              className={textareaClass}
            />
          </div>
        );
      case "cta":
        return (
          <div className="space-y-2">
            <Input
              value={(draft.heading as string) ?? ""}
              placeholder="Heading"
              onChange={(e) => set("heading", e.target.value)}
              className={inputClass}
            />
            <Input
              value={(draft.label as string) ?? ""}
              placeholder="Button label"
              onChange={(e) => set("label", e.target.value)}
              className={inputClass}
            />
          </div>
        );
      case "faq":
        return <FaqRows items={(draft.items as { question: string; answer: string }[]) ?? []} onChange={(v) => set("items", v)} />;
      default:
        return <p className="text-xs text-fg-subtle">Unrecognised section type: {section.section_type}</p>;
    }
  })();

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-fg">{SECTION_TYPE_LABEL[section.section_type] ?? section.section_type}</h4>
          {section.source === "operator_edited" && (
            <span className="rounded bg-surface-subtle px-1.5 py-0.5 text-xs font-medium text-fg-muted">Edited</span>
          )}
        </div>
        <button type="button" onClick={handleRegenerate} disabled={regenerating} className="text-xs font-medium text-fg-muted hover:underline">
          {regenerating ? "Regenerating…" : "Regenerate"}
        </button>
      </div>

      <div className="mt-2">{fields}</div>

      {section.needs_confirmation_notes.length > 0 && (
        <div className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-300">
          <p className="font-medium">Needs confirmation:</p>
          <ul className="list-disc pl-4">
            {section.needs_confirmation_notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      {preview && (
        <div className="mt-3 rounded-md border border-dashed border-border bg-surface-subtle p-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Proposed replacement</p>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-fg">{JSON.stringify(preview.content, null, 2)}</pre>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={handleApplyPreview} className="btn btn-primary btn-sm">
              Apply
            </button>
            <button type="button" onClick={() => setPreview(null)} className="text-xs text-fg-muted hover:underline">
              Discard
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-error">{error}</p>}

      <div className="mt-2 flex items-center gap-2">
        <button type="button" onClick={handleSave} disabled={!dirty || status === "saving"} className="btn btn-secondary btn-sm">
          {status === "saving" ? "Saving…" : "Save"}
        </button>
        <p className="text-xs text-fg-subtle">
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : dirty ? "Unsaved changes" : ""}
          {pageApproved && !dirty && " · Approved"}
        </p>
      </div>
    </div>
  );
}
