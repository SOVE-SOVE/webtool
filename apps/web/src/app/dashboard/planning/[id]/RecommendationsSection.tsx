"use client";

import { useState } from "react";
import { api, ApiError, type Planning, type Recommendation, type RecommendationCategory } from "@/lib/api";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Badge } from "@/components/ui/Badge";
import { featureLabel, recommendationFeatureKey } from "./websiteBlueprintLib";

const CATEGORY_LABEL: Record<RecommendationCategory, string> = { keep: "Keep", improve: "Improve", add: "Add" };
const CATEGORY_HINT: Record<RecommendationCategory, string> = {
  keep: "Existing strengths worth retaining",
  improve: "Weaknesses backed by real evidence",
  add: "Recommended new pages, content, or functionality",
};

const SOURCE_LABEL: Record<Recommendation["source_type"], string> = {
  audit_finding: "Audit finding",
  review_theme: "Review theme",
  social_presence: "Social Presence",
  business_info: "Business record",
  comparable_research: "Comparable research",
  operator: "Added by operator",
};

function RecommendationCard({
  planningId,
  rec,
  onUpdated,
}: {
  planningId: string;
  rec: Recommendation;
  onUpdated: (p: Planning) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(rec.title);
  const [explanation, setExplanation] = useState(rec.explanation);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every mutation reports its own failure next to the card it came
  // from — never a silent no-op the operator would only notice later.
  async function run(action: () => Promise<Planning>, failure: string): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      onUpdated(await action());
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : failure);
      return false;
    } finally {
      setSaving(false);
    }
  }

  function setStatus(status: "accepted" | "dismissed") {
    return run(
      () => api.updateRecommendation(planningId, rec.id, { status }),
      status === "accepted" ? "Couldn't accept this recommendation." : "Couldn't dismiss this recommendation.",
    );
  }

  function handleDelete() {
    return run(() => api.deleteRecommendation(planningId, rec.id), "Couldn't remove this recommendation.");
  }

  return (
    <li className="rounded-md border border-border p-3">
      {editing ? (
        <div className="space-y-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="input font-medium"
          />
          <Textarea
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            rows={2}
            className="input"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={async () => {
                const ok = await run(
                  () => api.updateRecommendation(planningId, rec.id, { title, explanation }),
                  "Couldn't save this recommendation.",
                );
                if (ok) setEditing(false);
              }}
              className="btn btn-secondary btn-sm"
            >
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className="text-xs text-fg-muted hover:underline">
              Cancel
            </button>
          </div>
          {error && <p className="text-error">{error}</p>}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="text-sm font-medium text-fg">{rec.title}</p>
            <Badge tone="muted" className="shrink-0">
              {SOURCE_LABEL[rec.source_type]}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-fg-muted">{rec.explanation}</p>
          {rec.source_evidence && <p className="mt-1 text-xs italic text-fg-subtle">&ldquo;{rec.source_evidence}&rdquo;</p>}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
            {rec.status !== "accepted" && (
              <button
                type="button"
                onClick={() => setStatus("accepted")}
                disabled={saving}
                className="font-medium text-emerald-700 hover:underline disabled:opacity-50 dark:text-emerald-400"
              >
                Accept
              </button>
            )}
            {rec.status !== "dismissed" && (
              <button
                type="button"
                onClick={() => setStatus("dismissed")}
                disabled={saving}
                className="font-medium text-fg-muted hover:underline disabled:opacity-50"
              >
                Dismiss
              </button>
            )}
            <button type="button" onClick={() => setEditing(true)} className="font-medium text-fg-muted hover:underline">
              Edit
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving}
              className="font-medium text-fg-subtle hover:underline disabled:opacity-50"
            >
              Remove
            </button>
            {rec.status === "proposed" && <span className="text-fg-subtle">Proposed — awaiting a decision</span>}
            {rec.status === "accepted" && <span className="text-emerald-700 dark:text-emerald-400">Accepted</span>}
            {rec.status === "dismissed" && <span className="text-fg-subtle">Dismissed</span>}
          </div>
          {error && <p className="mt-1 text-error">{error}</p>}
        </>
      )}
    </li>
  );
}

/**
 * Build Brief's "Keep / Improve / Add" (docs/05_DECISIONS.md). Works in
 * either Planning mode — `improve` is only ever populated when the
 * agent had real audit findings or review themes to cite (see
 * agents/planning_recommendations.py's hard rule).
 *
 * `filter` narrows which recommendations are listed — the Plan step's
 * "Site-wide improvements" panel passes `isSiteWideRecommendation`, since
 * feature recommendations are decided in the feature library there. It
 * only affects the lists: Generate/Regenerate still act on (and label
 * themselves from) every recommendation, because that's what the backend
 * regenerates. `generateHint` is an optional line under the objective
 * explaining that wider effect.
 */
export function RecommendationsSection({
  planning,
  onUpdated,
  filter,
  generateHint,
}: {
  planning: Planning;
  onUpdated: (p: Planning) => void;
  filter?: (r: Recommendation) => boolean;
  generateHint?: string;
}) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingCategory, setAddingCategory] = useState<RecommendationCategory | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newExplanation, setNewExplanation] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // Set when a just-added recommendation doesn't pass `filter` — it was
  // saved, but it's listed somewhere else, so say where rather than let it
  // look like it vanished.
  const [addedElsewhere, setAddedElsewhere] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      onUpdated(await api.generateRecommendations(planning.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't generate recommendations.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleAdd(category: RecommendationCategory) {
    if (!newTitle.trim()) return;
    setAdding(true);
    setAddError(null);
    setAddedElsewhere(null);
    try {
      const before = new Set(planning.recommendations.map((r) => r.id));
      const updated = await api.addRecommendation(planning.id, {
        category,
        title: newTitle,
        explanation: newExplanation || "",
      });
      onUpdated(updated);
      const created = updated.recommendations.find((r) => !before.has(r.id));
      if (created && filter && !filter(created)) {
        const featureKey = recommendationFeatureKey(created);
        setAddedElsewhere(
          featureKey
            ? `“${created.title}” matches the ${featureLabel(featureKey)} feature, so it's listed in the feature library's Recommended view.`
            : `“${created.title}” was added, but it's listed elsewhere.`,
        );
      }
      setAddingCategory(null);
      setNewTitle("");
      setNewExplanation("");
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : "Couldn't add that recommendation.");
    } finally {
      setAdding(false);
    }
  }

  const hasAny = planning.recommendations.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-fg-muted">{planning.recommendations_objective || "Not generated yet."}</p>
          {generateHint && <p className="mt-0.5 text-xs text-fg-subtle">{generateHint}</p>}
        </div>
        <button type="button" onClick={handleGenerate} disabled={generating} className="btn btn-primary btn-sm shrink-0">
          {generating ? "Generating…" : hasAny ? "Regenerate" : "Generate"}
        </button>
      </div>
      {error && <p className="text-error">{error}</p>}
      {addedElsewhere && (
        <p role="status" className="rounded-md bg-surface-subtle px-3 py-2 text-xs text-fg-muted">
          {addedElsewhere}
        </p>
      )}

      {(["keep", "improve", "add"] as RecommendationCategory[]).map((category) => {
        const items = planning.recommendations
          .filter((r) => r.category === category && r.status !== "dismissed" && (!filter || filter(r)))
          .sort((a, b) => a.order_index - b.order_index);
        return (
          <div key={category}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-fg">{CATEGORY_LABEL[category]}</h3>
                <p className="text-xs text-fg-subtle">{CATEGORY_HINT[category]}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAddingCategory(addingCategory === category ? null : category);
                  setAddError(null);
                }}
                aria-expanded={addingCategory === category}
                aria-label={`Add a ${CATEGORY_LABEL[category]} recommendation`}
                className="text-xs font-medium text-fg-muted hover:underline"
              >
                + Add
              </button>
            </div>
            {addingCategory === category && (
              <div className="mt-2 space-y-2 rounded-md border border-border p-3">
                <Input
                  placeholder="Title"
                  aria-label="Recommendation title"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="input"
                />
                <Textarea
                  placeholder="Explanation"
                  aria-label="Recommendation explanation"
                  value={newExplanation}
                  onChange={(e) => setNewExplanation(e.target.value)}
                  rows={2}
                  className="input"
                />
                <button
                  type="button"
                  onClick={() => handleAdd(category)}
                  disabled={adding || !newTitle.trim()}
                  className="btn btn-secondary btn-sm"
                >
                  {adding ? "Adding…" : "Add"}
                </button>
                {addError && <p className="text-error">{addError}</p>}
              </div>
            )}
            {items.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {items.map((rec) => (
                  <RecommendationCard key={rec.id} planningId={planning.id} rec={rec} onUpdated={onUpdated} />
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-fg-subtle">Nothing here yet.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
