"use client";

import { useState } from "react";
import { api, ApiError, type Planning } from "@/lib/api";

/**
 * New Website Plan mode's one primary action — the counterpart to
 * AnalyseWebsiteAction.tsx for a Lead with no website to audit. No URL
 * to enter here (there's nothing to fetch); this is a synchronous call
 * that builds a plan from whatever's already verified about the
 * business (see agents/planning_website_direction.py).
 */
export function GenerateWebsitePlanAction({
  planning,
  onGenerated,
  variant = "empty",
}: {
  planning: Planning;
  onGenerated: (p: Planning) => void;
  variant?: "empty" | "inline";
}) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alreadyGenerated = planning.website_plan_generated_at !== null;

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      onGenerated(await api.generateWebsitePlan(planning.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't generate the website plan.");
    } finally {
      setGenerating(false);
    }
  }

  const button = (
    <button type="button" onClick={handleGenerate} disabled={generating} className="btn btn-primary btn-sm">
      {generating ? "Generating…" : alreadyGenerated ? "Regenerate plan" : "Generate Website Plan"}
    </button>
  );

  if (variant === "inline") {
    return (
      <div>
        {button}
        {error && <p className="mt-2 text-error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-dashed border-border px-6 py-12 text-center">
      <p className="text-sm font-medium text-fg">No website yet</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-fg-muted">
        Build a website-planning brief from everything already verified about this business — recommended objective,
        priority pages, and what to include — plus an optional look at comparable public sites.
      </p>
      <div className="mt-4 flex justify-center">{button}</div>
      {error && <p className="mt-2 text-error">{error}</p>}
    </div>
  );
}
