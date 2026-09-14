"use client";

import { useState } from "react";
import { api, ApiError, type Planning, type Recommendation, type RecommendationCategory } from "@/lib/api";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";

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

  async function setStatus(status: "accepted" | "dismissed") {
    onUpdated(await api.updateRecommendation(planningId, rec.id, { status }));
  }

  async function handleDelete() {
    onUpdated(await api.deleteRecommendation(planningId, rec.id));
  }

  return (
    <li className="rounded-md border border-border p-3">
      {editing ? (
        <div className="space-y-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-border-strong bg-surface px-2 py-1 text-sm font-medium"
          />
          <Textarea
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-border-strong bg-surface px-2 py-1 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  onUpdated(await api.updateRecommendation(planningId, rec.id, { title, explanation }));
                  setEditing(false);
                } finally {
                  setSaving(false);
                }
              }}
              className="btn btn-secondary btn-sm"
            >
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className="text-xs text-fg-muted hover:underline">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="text-sm font-medium text-fg">{rec.title}</p>
            <span className="shrink-0 rounded bg-surface-subtle px-1.5 py-0.5 text-xs font-medium text-fg-muted">
              {SOURCE_LABEL[rec.source_type]}
            </span>
          </div>
          <p className="mt-1 text-sm text-fg-muted">{rec.explanation}</p>
          {rec.source_evidence && <p className="mt-1 text-xs italic text-fg-subtle">&ldquo;{rec.source_evidence}&rdquo;</p>}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
            {rec.status !== "accepted" && (
              <button
                type="button"
                onClick={() => setStatus("accepted")}
                className="font-medium text-emerald-700 hover:underline dark:text-emerald-400"
              >
                Accept
              </button>
            )}
            {rec.status !== "dismissed" && (
              <button type="button" onClick={() => setStatus("dismissed")} className="font-medium text-fg-muted hover:underline">
                Dismiss
              </button>
            )}
            <button type="button" onClick={() => setEditing(true)} className="font-medium text-fg-muted hover:underline">
              Edit
            </button>
            <button type="button" onClick={handleDelete} className="font-medium text-fg-subtle hover:underline">
              Remove
            </button>
            {rec.status === "proposed" && <span className="text-fg-subtle">Proposed — awaiting a decision</span>}
            {rec.status === "accepted" && <span className="text-emerald-700 dark:text-emerald-400">Accepted</span>}
            {rec.status === "dismissed" && <span className="text-fg-subtle">Dismissed</span>}
          </div>
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
 */
export function RecommendationsSection({ planning, onUpdated }: { planning: Planning; onUpdated: (p: Planning) => void }) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingCategory, setAddingCategory] = useState<RecommendationCategory | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newExplanation, setNewExplanation] = useState("");

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
    onUpdated(
      await api.addRecommendation(planning.id, { category, title: newTitle, explanation: newExplanation || "" }),
    );
    setAddingCategory(null);
    setNewTitle("");
    setNewExplanation("");
  }

  const hasAny = planning.recommendations.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-fg-muted">{planning.recommendations_objective || "Not generated yet."}</p>
        <button type="button" onClick={handleGenerate} disabled={generating} className="btn btn-primary btn-sm shrink-0">
          {generating ? "Generating…" : hasAny ? "Regenerate" : "Generate"}
        </button>
      </div>
      {error && <p className="text-error">{error}</p>}

      {(["keep", "improve", "add"] as RecommendationCategory[]).map((category) => {
        const items = planning.recommendations
          .filter((r) => r.category === category && r.status !== "dismissed")
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
                onClick={() => setAddingCategory(addingCategory === category ? null : category)}
                className="text-xs font-medium text-fg-muted hover:underline"
              >
                + Add
              </button>
            </div>
            {addingCategory === category && (
              <div className="mt-2 space-y-2 rounded-md border border-border p-3">
                <Input
                  placeholder="Title"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full rounded-md border border-border-strong bg-surface px-2 py-1 text-sm"
                />
                <Textarea
                  placeholder="Explanation"
                  value={newExplanation}
                  onChange={(e) => setNewExplanation(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-border-strong bg-surface px-2 py-1 text-sm"
                />
                <button type="button" onClick={() => handleAdd(category)} className="btn btn-secondary btn-sm">
                  Add
                </button>
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
