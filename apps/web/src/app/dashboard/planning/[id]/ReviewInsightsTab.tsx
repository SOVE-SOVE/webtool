"use client";

import { useState } from "react";
import { api, ApiError, type Planning, type ReviewTheme } from "@/lib/api";
import { REVIEW_TREND_LABEL } from "../lib";
import { AutoSaveTextarea } from "./AutoSaveTextarea";

function ThemeList({ title, themes }: { title: string; themes: ReviewTheme[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div>
      <p className="text-xs font-medium text-fg-subtle">{title}</p>
      {themes.length === 0 ? (
        <p className="mt-0.5 text-sm text-fg-subtle">None identified</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {themes.map((t) => (
            <li key={t.theme}>
              <button
                type="button"
                onClick={() => setExpanded(expanded === t.theme ? null : t.theme)}
                className="flex w-full items-center justify-between gap-2 text-left text-sm text-fg hover:underline"
              >
                <span>{t.theme}</span>
                <span className="shrink-0 text-xs font-normal text-fg-subtle">
                  {t.occurrences} review{t.occurrences === 1 ? "" : "s"}
                </span>
              </button>
              {expanded === t.theme && (
                <ul className="ml-3 mt-1 space-y-1 border-l border-border pl-3">
                  {t.evidence.length > 0 ? (
                    t.evidence.map((e, i) => (
                      <li key={i} className="text-xs text-fg-subtle">
                        &ldquo;{e}&rdquo;
                      </li>
                    ))
                  ) : (
                    <li className="text-xs text-fg-subtle">No evidence snippet recorded.</li>
                  )}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The isolated Google Review Insights feature — unchanged logic, just
 * given its own tab instead of sharing a long scroll with the audit.
 * Works independently of the website audit (a lead's reviews can be
 * pulled before or after "Analyse Website" has ever run).
 */
export function ReviewInsightsTab({
  planning,
  onUpdated,
}: {
  planning: Planning;
  onUpdated: (updated: Planning) => void;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const review = planning.review_intelligence;

  async function handleRun() {
    setRunning(true);
    setError(null);
    try {
      onUpdated(await api.runReviewInsights(planning.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't run review insights.");
    } finally {
      setRunning(false);
    }
  }

  async function handleSaveReviewSummary(value: string) {
    onUpdated(await api.updatePlanning(planning.id, { review_summary: value }));
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-sm text-fg-muted">
          Uses verified Google review data to help plan what this website should emphasise.
        </p>
        <button type="button" onClick={handleRun} disabled={running} className="btn btn-secondary btn-sm shrink-0">
          {running ? "Running…" : review ? "Refresh insights" : "Run Review Insights"}
        </button>
      </div>
      {error && <p className="text-error">{error}</p>}

      {!review && !running && (
        <p className="text-sm text-fg-subtle">No review data yet — run insights to pull this lead&apos;s Google reviews.</p>
      )}

      {review && review.data_status === "no_listing" && (
        <p className="text-sm text-fg-subtle">
          {review.data_limitations || "No Google listing found for this business."}
        </p>
      )}
      {review && review.data_status === "unavailable" && (
        <p className="text-sm text-fg-subtle">
          {review.data_limitations || "Google review data is currently unavailable."}
        </p>
      )}

      {review && review.data_status === "ok" && (
        <div className="space-y-5">
          {/* 1. Reputation Snapshot */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Reputation snapshot</h3>
            <div className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
              <div>
                <span className="text-fg-muted">Rating </span>
                <span className="font-medium text-fg">
                  {review.google_rating !== null ? `${review.google_rating.toFixed(1)}★` : "Not available"}
                </span>
              </div>
              <div>
                <span className="text-fg-muted">Reviews </span>
                <span className="font-medium text-fg">{review.google_review_count ?? "Not available"}</span>
              </div>
              <div>
                <span className="text-fg-muted">Most recent review </span>
                <span className="font-medium text-fg">
                  {review.last_review_at ? new Date(review.last_review_at).toLocaleDateString() : "Unknown"}
                </span>
              </div>
              <div>
                <span className="text-fg-muted">Volume trend </span>
                <span className="font-medium text-fg">{REVIEW_TREND_LABEL[review.review_volume_trend]}</span>
              </div>
              <div>
                <span className="text-fg-muted">Owner-response rate </span>
                <span className="font-medium text-fg-subtle">Not available (Google doesn&apos;t expose this)</span>
              </div>
            </div>
          </div>

          {/* 2. Customer Themes */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Customer themes</h3>
            {review.themes_data_sufficient ? (
              <div className="mt-1.5 space-y-2.5">
                <ThemeList title="Recurring strengths" themes={review.positive_review_themes} />
                <ThemeList title="Recurring concerns" themes={review.negative_review_themes} />
              </div>
            ) : (
              <p className="mt-1.5 text-sm text-fg-subtle">
                Not enough review text yet to identify recurring themes ({review.reviews_with_text} review(s) with
                text).
              </p>
            )}
          </div>

          {/* 3. Website Opportunities */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Website opportunities</h3>
            {planning.review_website_opportunities.length > 0 ? (
              <ul className="mt-1.5 space-y-1.5">
                {planning.review_website_opportunities.map((o, i) => (
                  <li key={i} className="rounded-md border border-border p-2 text-sm">
                    <p className="text-fg">{o.recommendation}</p>
                    <p className="mt-0.5 text-xs text-fg-subtle">Based on: {o.based_on_theme}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-sm text-fg-subtle">
                {planning.review_insights_generated_at
                  ? "No opportunities identified from the available themes."
                  : "Run Review Insights to generate these."}
              </p>
            )}
          </div>

          {/* 4. FAQ Opportunities */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">FAQ opportunities</h3>
            {planning.review_faq_opportunities.length > 0 ? (
              <ul className="mt-1.5 space-y-1.5">
                {planning.review_faq_opportunities.map((f, i) => (
                  <li key={i} className="rounded-md border border-border p-2 text-sm">
                    <p className="text-fg">{f.question}</p>
                    <p className="mt-0.5 text-xs text-fg-subtle">
                      Based on: {f.based_on_theme} · Needs business-owner confirmation
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-sm text-fg-subtle">
                {planning.review_insights_generated_at
                  ? "No FAQ topics identified from the available themes."
                  : "Run Review Insights to generate these."}
              </p>
            )}
          </div>

          {/* 5. Review-to-Website Gaps */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Review-to-website gaps</h3>
            {planning.review_website_gaps.length > 0 ? (
              <ul className="mt-1.5 space-y-1.5">
                {planning.review_website_gaps.map((g, i) => (
                  <li key={i} className="rounded-md border border-border p-2 text-sm">
                    <p className="text-fg">{g.gap}</p>
                    <p className="mt-0.5 text-xs text-fg-subtle">Based on: {g.based_on_theme}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-sm text-fg-subtle">
                {planning.website_audit_id === null
                  ? 'Run "Analyse Website" too, so gaps can be compared against the current site.'
                  : planning.review_insights_generated_at
                    ? "No gaps identified."
                    : "Run Review Insights to generate these."}
              </p>
            )}
          </div>

          {/* 6. Neutral Review Summary */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Review summary</h3>
            <div className="mt-1.5">
              <AutoSaveTextarea
                key={planning.id + (planning.review_insights_generated_at ?? "")}
                defaultValue={planning.review_summary ?? ""}
                onSave={handleSaveReviewSummary}
                rows={3}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
