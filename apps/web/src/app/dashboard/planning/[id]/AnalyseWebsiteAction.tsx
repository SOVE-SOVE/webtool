"use client";

import { useState, type FormEvent } from "react";
import { api, ApiError, type Planning } from "@/lib/api";

/**
 * The one primary "Analyse Website" action — used both as the focused
 * empty state (never analysed / failed with nothing to show yet) and,
 * compactly, wherever a retry needs to be offered. Never duplicated
 * alongside itself: this is the single place that starts a run.
 */
export function AnalyseWebsiteAction({
  planning,
  onAnalysed,
  variant = "empty",
}: {
  planning: Planning;
  onAnalysed: (p: Planning) => void;
  variant?: "empty" | "inline";
}) {
  const [url, setUrl] = useState(planning.website_url ?? "");
  const [analysing, setAnalysing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isRetry = planning.status === "failed";

  async function handleAnalyse(e: FormEvent) {
    e.preventDefault();
    setAnalysing(true);
    setError(null);
    try {
      onAnalysed(await api.analysePlanning(planning.id, url.trim() ? { website_url: url.trim() } : undefined));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start the analysis.");
    } finally {
      setAnalysing(false);
    }
  }

  const form = (
    <form
      onSubmit={handleAnalyse}
      className={`flex flex-wrap items-center gap-2 ${variant === "empty" ? "justify-center" : ""}`}
    >
      {!planning.website_url && (
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          required
          className="w-full max-w-sm rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm sm:w-auto"
        />
      )}
      <button type="submit" disabled={analysing || !url.trim()} className="btn btn-primary btn-sm">
        {analysing ? "Starting…" : isRetry ? "Retry analysis" : "Analyse Website"}
      </button>
    </form>
  );

  if (variant === "inline") {
    return (
      <div>
        {form}
        {error && <p className="mt-2 text-error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-dashed border-border px-6 py-12 text-center">
      <p className="text-sm font-medium text-fg">{isRetry ? "The last analysis didn't finish" : "No website analysis yet"}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-fg-muted">
        {isRetry
          ? "Something went wrong partway through — try again below."
          : "Run a website analysis to get top opportunities, a neutral summary, and evidence-backed findings."}
      </p>
      <div className="mt-4">{form}</div>
      {error && <p className="mt-2 text-error">{error}</p>}
    </div>
  );
}
