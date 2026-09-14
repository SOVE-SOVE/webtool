"use client";

import { useState } from "react";
import { api, ApiError, type Planning, type VisualDirectionOption } from "@/lib/api";

const FIELD_LABEL: Record<keyof VisualDirectionOption, string> = {
  character: "Character",
  typography: "Typography",
  colour_palette: "Colour palette",
  imagery: "Imagery",
  layout: "Layout",
};

function DirectionCard({
  option,
  selected,
  onSelect,
}: {
  option: VisualDirectionOption;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div className={`rounded-md border p-3 ${selected ? "border-accent bg-surface-subtle" : "border-border"}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-fg">{option.character}</p>
        {selected ? (
          <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
            Selected
          </span>
        ) : (
          <button type="button" onClick={onSelect} className="shrink-0 text-xs font-medium text-fg-muted hover:underline">
            Select
          </button>
        )}
      </div>
      <dl className="mt-2 space-y-1 text-xs">
        {(["typography", "colour_palette", "imagery", "layout"] as const).map((field) => (
          <div key={field}>
            <dt className="inline font-medium text-fg-subtle">{FIELD_LABEL[field]}: </dt>
            <dd className="inline text-fg-muted">{option[field]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Build Brief's "Visual Direction Choices" — 2-3 concise options; the
 * selected one is written into a real CreativeDirectionBrief at Create
 * Project (see agents/planning_visual_directions.py). */
export function VisualDirectionsSection({ planning, onUpdated }: { planning: Planning; onUpdated: (p: Planning) => void }) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingSelected, setEditingSelected] = useState(false);
  const [draft, setDraft] = useState<VisualDirectionOption | null>(null);

  const selected = planning.selected_visual_direction;

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      onUpdated(await api.generateVisualDirections(planning.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't generate visual direction choices.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSelect(index: number) {
    onUpdated(await api.selectVisualDirection(planning.id, { option_index: index }));
  }

  function startEdit() {
    if (!selected) return;
    setDraft({ ...selected });
    setEditingSelected(true);
  }

  async function saveEdit() {
    if (!draft) return;
    onUpdated(await api.selectVisualDirection(planning.id, draft));
    setEditingSelected(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button type="button" onClick={handleGenerate} disabled={generating} className="btn btn-primary btn-sm">
          {generating ? "Generating…" : planning.visual_direction_options.length > 0 ? "Regenerate options" : "Generate options"}
        </button>
      </div>
      {error && <p className="text-error">{error}</p>}

      {planning.visual_direction_options.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {planning.visual_direction_options.map((option, i) => (
            <DirectionCard
              key={i}
              option={option}
              selected={!!selected && JSON.stringify(option) === JSON.stringify(selected)}
              onSelect={() => handleSelect(i)}
            />
          ))}
        </div>
      )}

      {selected && (
        <div className="rounded-md border border-border bg-surface-subtle p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Selected direction</p>
            {!editingSelected && (
              <button type="button" onClick={startEdit} className="text-xs font-medium text-fg-muted hover:underline">
                Edit
              </button>
            )}
          </div>
          {editingSelected && draft ? (
            <div className="mt-2 space-y-2">
              {(Object.keys(FIELD_LABEL) as (keyof VisualDirectionOption)[]).map((field) => (
                <div key={field}>
                  <label className="text-xs font-medium text-fg-subtle">{FIELD_LABEL[field]}</label>
                  <input
                    value={draft[field]}
                    onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
                    className="w-full rounded-md border border-border-strong bg-surface px-2 py-1 text-sm"
                  />
                </div>
              ))}
              <div className="flex gap-2">
                <button type="button" onClick={saveEdit} className="btn btn-secondary btn-sm">
                  Save
                </button>
                <button type="button" onClick={() => setEditingSelected(false)} className="text-xs text-fg-muted hover:underline">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <dl className="mt-2 space-y-1 text-sm">
              {(Object.keys(FIELD_LABEL) as (keyof VisualDirectionOption)[]).map((field) => (
                <div key={field}>
                  <dt className="inline font-medium text-fg-subtle">{FIELD_LABEL[field]}: </dt>
                  <dd className="inline text-fg">{selected[field]}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
