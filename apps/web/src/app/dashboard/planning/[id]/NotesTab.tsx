"use client";

import { api, type Planning } from "@/lib/api";
import { AutoSaveTextarea } from "./AutoSaveTextarea";

/**
 * Operator Notes — simple and prominent by design: one field, no
 * surrounding clutter. Notes live on the LeadPlanning row itself
 * (independent of website_audit_id), so they survive every re-analysis.
 */
export function NotesTab({ planning, onUpdated }: { planning: Planning; onUpdated: (p: Planning) => void }) {
  async function handleSave(value: string) {
    onUpdated(await api.updatePlanning(planning.id, { operator_notes: value }));
  }

  return (
    <div className="max-w-2xl">
      <h2 className="section-title">Operator notes</h2>
      <p className="mt-0.5 text-sm text-fg-muted">
        Your own observations, preparation, or build ideas — independent of the analysis above, and preserved across
        every re-analysis.
      </p>
      <div className="mt-3">
        <AutoSaveTextarea
          key={planning.id + "-notes"}
          defaultValue={planning.operator_notes ?? ""}
          onSave={handleSave}
          rows={10}
          placeholder="Notes for the next conversation or the build itself…"
        />
      </div>
    </div>
  );
}
