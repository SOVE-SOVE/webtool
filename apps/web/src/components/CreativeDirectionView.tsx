"use client";

import { useState } from "react";
import { api, type CreativeDirectionBrief, type CreativeDirectionUpdate } from "@/lib/api";

type StrField = keyof Pick<
  CreativeDirectionBrief,
  | "creative_concept"
  | "visual_direction"
  | "colour_direction"
  | "typography_direction"
  | "image_direction"
  | "layout_direction"
  | "ux_direction"
  | "tone_of_voice"
  | "visual_hierarchy"
  | "cta_strategy"
>;

type ListField = keyof Pick<
  CreativeDirectionBrief,
  "brand_personality" | "things_to_avoid" | "references_inspiration"
>;

const STR_SECTIONS: { field: StrField; label: string }[] = [
  { field: "creative_concept", label: "Creative concept" },
  { field: "visual_direction", label: "Visual direction" },
  { field: "colour_direction", label: "Colour direction" },
  { field: "typography_direction", label: "Typography direction" },
  { field: "image_direction", label: "Image direction" },
  { field: "layout_direction", label: "Layout direction" },
  { field: "ux_direction", label: "UX direction" },
  { field: "tone_of_voice", label: "Tone of voice" },
  { field: "visual_hierarchy", label: "Recommended visual hierarchy" },
  { field: "cta_strategy", label: "Recommended CTA strategy" },
];

const LIST_SECTIONS: { field: ListField; label: string }[] = [
  { field: "brand_personality", label: "Brand personality" },
  { field: "things_to_avoid", label: "Things to avoid" },
  { field: "references_inspiration", label: "References / inspiration" },
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

export function CreativeDirectionView({
  brief,
  onChange,
}: {
  brief: CreativeDirectionBrief;
  onChange: (updated: CreativeDirectionBrief) => void;
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
      const update: CreativeDirectionUpdate = {};
      for (const { field } of STR_SECTIONS) update[field] = draft[field];
      for (const { field } of LIST_SECTIONS) update[field] = fromLines(draft[field] ?? "");
      const updated = await api.updateCreativeDirection(brief.id, update);
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
      const updated = await api.approveCreativeDirection(brief.id);
      onChange(updated);
    } catch {
      setError("Couldn't approve this direction.");
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
              {approving ? "Approving…" : "Approve — continue to build"}
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
        "Facts (confirmed, from the business record/audit/research)",
        bulletList(brief.facts),
      )}
      {section(
        "Assumptions (not confirmed — verify with the client before relying on these)",
        brief.assumptions.length === 0 ? (
          <p className="text-neutral-400">—</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-amber-800">
            {brief.assumptions.map((item, i) => (
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

      {(brief.target_audience || brief.business_goals) &&
        section(
          "Client-supplied context used",
          <div className="space-y-1">
            {brief.target_audience && (
              <p>
                <span className="text-neutral-500">Target audience: </span>
                {brief.target_audience}
              </p>
            )}
            {brief.business_goals && (
              <p>
                <span className="text-neutral-500">Business goals: </span>
                {brief.business_goals}
              </p>
            )}
          </div>,
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
