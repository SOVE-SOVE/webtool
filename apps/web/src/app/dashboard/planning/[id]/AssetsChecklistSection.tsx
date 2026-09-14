"use client";

import { useState } from "react";
import { api, ApiError, ASSET_STATUSES, ASSET_STATUS_LABELS, type AssetStatus, type Planning, type PlanningAsset } from "@/lib/api";

const STATUS_DOT: Record<AssetStatus, string> = {
  ready_to_use: "bg-emerald-500",
  reference_only: "bg-amber-500",
  needs_owner_approval: "bg-amber-500",
  missing: "bg-fg-subtle",
};

function AssetRow({ planningId, asset, onUpdated }: { planningId: string; asset: PlanningAsset; onUpdated: (p: Planning) => void }) {
  const [editingNote, setEditingNote] = useState(false);
  const [note, setNote] = useState(asset.note ?? "");

  async function setStatus(status: AssetStatus) {
    onUpdated(await api.updateAsset(planningId, asset.id, { status }));
  }

  async function saveNote() {
    onUpdated(await api.updateAsset(planningId, asset.id, { note: note || null }));
    setEditingNote(false);
  }

  return (
    <li className="flex flex-col gap-1.5 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-medium text-fg">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[asset.status]}`} aria-hidden="true" />
          {asset.label}
        </p>
        {editingNote ? (
          <div className="mt-1 flex gap-2">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note"
              className="w-full rounded-md border border-border-strong bg-surface px-2 py-1 text-xs"
            />
            <button type="button" onClick={saveNote} className="shrink-0 text-xs font-medium text-fg-muted hover:underline">
              Save
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setEditingNote(true)} className="mt-0.5 text-left text-xs text-fg-subtle hover:underline">
            {asset.note || "Add a note…"}
          </button>
        )}
      </div>
      <select
        value={asset.status}
        onChange={(e) => setStatus(e.target.value as AssetStatus)}
        className="shrink-0 rounded-md border border-border-strong bg-surface px-2 py-1 text-xs"
      >
        {ASSET_STATUSES.map((s) => (
          <option key={s} value={s}>
            {ASSET_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
    </li>
  );
}

/** Build Brief's Assets Checklist — seeded from real records, refreshed
 * additively (see LeadPlanningAsset's docstring). A publicly-visible
 * social image is always "Reference only", never "Ready to use". */
export function AssetsChecklistSection({ planning, onUpdated }: { planning: Planning; onUpdated: (p: Planning) => void }) {
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      onUpdated(await api.refreshAssetsChecklist(planning.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't refresh the assets checklist.");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleAdd() {
    if (!newLabel.trim()) return;
    onUpdated(await api.addAsset(planning.id, { category: "other", label: newLabel, status: "missing" }));
    setAdding(false);
    setNewLabel("");
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setAdding((v) => !v)} className="btn btn-secondary btn-sm">
          + Add asset
        </button>
        <button type="button" onClick={handleRefresh} disabled={refreshing} className="btn btn-primary btn-sm">
          {refreshing ? "Refreshing…" : planning.assets.length > 0 ? "Refresh checklist" : "Build checklist"}
        </button>
      </div>
      {error && <p className="text-error">{error}</p>}
      {adding && (
        <div className="flex gap-2 rounded-md border border-border p-3">
          <input
            placeholder="Asset label"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            className="w-full rounded-md border border-border-strong bg-surface px-2 py-1 text-sm"
          />
          <button type="button" onClick={handleAdd} className="btn btn-secondary btn-sm shrink-0">
            Add
          </button>
        </div>
      )}
      {planning.assets.length > 0 ? (
        <ul className="space-y-2">
          {planning.assets.map((asset) => (
            <AssetRow key={asset.id} planningId={planning.id} asset={asset} onUpdated={onUpdated} />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-fg-subtle">Nothing here yet.</p>
      )}
    </div>
  );
}
