"use client";

import { useState } from "react";
import { api, type WebsiteBrief, type WebsiteBriefUpdate } from "@/lib/api";

type StrField = keyof Pick<
  WebsiteBrief,
  "project_summary" | "target_audience" | "positioning" | "cta_strategy" | "visual_direction"
>;

type ListField = keyof Pick<
  WebsiteBrief,
  | "goals"
  | "sitemap_summary"
  | "page_purposes"
  | "content_requirements"
  | "functionality"
  | "seo_considerations"
  | "technical_requirements"
>;

const STR_SECTIONS: { field: StrField; label: string }[] = [
  { field: "project_summary", label: "Project summary" },
  { field: "target_audience", label: "Target audience" },
  { field: "positioning", label: "Positioning" },
  { field: "cta_strategy", label: "CTA strategy" },
  { field: "visual_direction", label: "Visual direction" },
];

const LIST_SECTIONS: { field: ListField; label: string }[] = [
  { field: "goals", label: "Goals" },
  { field: "sitemap_summary", label: "Sitemap" },
  { field: "page_purposes", label: "Page purposes" },
  { field: "content_requirements", label: "Content requirements" },
  { field: "functionality", label: "Functionality" },
  { field: "seo_considerations", label: "SEO considerations" },
  { field: "technical_requirements", label: "Technical requirements" },
];

function section(title: string, content: React.ReactNode) {
  return (
    <div className="mt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</h3>
      <div className="mt-1 text-sm text-neutral-800">{content}</div>
    </div>
  );
}

function bulletList(items: string[]) {
  if (items.length === 0) return <p className="text-neutral-400">—</p>;
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function toLines(items: string[]): string {
  return items.join("\n");
}

function fromLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export function WebsiteBriefView({
  brief,
  onChange,
}: {
  brief: WebsiteBrief;
  onChange: (updated: WebsiteBrief) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing() {
    const initial: Record<string, string> = {};
    for (const { field } of STR_SECTIONS) initial[field] = brief[field];
    for (const { field } of LIST_SECTIONS) initial[field] = toLines(brief[field]);
    setDraft(initial);
    setError(null);
    setEditing(true);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const update: WebsiteBriefUpdate = {};
      for (const { field } of STR_SECTIONS) update[field] = draft[field];
      for (const { field } of LIST_SECTIONS) update[field] = fromLines(draft[field] ?? "");
      const updated = await api.updateWebsiteBrief(brief.id, update);
      onChange(updated);
      setEditing(false);
    } catch {
      setError("Couldn't save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function handleApprove() {
    setApproving(true);
    setError(null);
    try {
      const updated = await api.approveWebsiteBrief(brief.id);
      onChange(updated);
    } catch {
      setError("Couldn't approve this brief.");
    } finally {
      setApproving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              brief.status === "approved" ? "bg-emerald-100 text-emerald-800" : "bg-neutral-100 text-neutral-700"
            }`}
          >
            {brief.status === "approved" ? "Approved" : "Draft — review before continuing"}
          </span>
          {brief.flagged_for_review && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Flagged for review</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!editing && (
            <button
              onClick={startEditing}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
            >
              Edit
            </button>
          )}
          {editing && (
            <>
              <button
                onClick={() => setEditing(false)}
                disabled={saving}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </>
          )}
          {!editing && brief.status !== "approved" && (
            <button
              onClick={handleApprove}
              disabled={approving}
              className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {approving ? "Approving…" : "Approve — client-ready"}
            </button>
          )}
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {brief.review_notes && (
        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {brief.review_notes}
        </p>
      )}

      {section(
        "Confirmed client requirements (verbatim from the client's own intake answers)",
        bulletList(brief.confirmed_requirements),
      )}
      {section(
        "AI suggestions (not confirmed by the client — review before treating as final)",
        brief.ai_suggestions.length === 0 ? (
          <p className="text-neutral-400">—</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-amber-800">
            {brief.ai_suggestions.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        ),
      )}

      {STR_SECTIONS.map(({ field, label }) =>
        section(
          label,
          editing ? (
            <textarea
              value={draft[field] ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
              rows={3}
              className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
            />
          ) : (
            <p>{brief[field]}</p>
          ),
        ),
      )}

      {LIST_SECTIONS.map(({ field, label }) =>
        section(
          label,
          editing ? (
            <textarea
              value={draft[field] ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
              rows={3}
              placeholder="One per line"
              className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
            />
          ) : (
            bulletList(brief[field])
          ),
        ),
      )}

      {brief.sources_note && (
        <p className="mt-6 border-t border-neutral-200 pt-3 text-xs text-neutral-500">
          Sources: {brief.sources_note}
        </p>
      )}
      <p className="mt-2 text-xs text-neutral-400">
        Generated {new Date(brief.generated_at).toLocaleString()}
        {brief.generated_by_user_name ? ` by ${brief.generated_by_user_name}` : ""}
        {brief.edited_at ? ` · edited ${new Date(brief.edited_at).toLocaleString()}` : ""}
        {brief.edited_by_user_name ? ` by ${brief.edited_by_user_name}` : ""}
        {brief.approved_at ? ` · approved ${new Date(brief.approved_at).toLocaleString()}` : ""}
        {brief.approved_by_user_name ? ` by ${brief.approved_by_user_name}` : ""}
      </p>
    </div>
  );
}
