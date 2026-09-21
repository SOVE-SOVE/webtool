"use client";

import { useState, type ReactNode } from "react";
import { api, ApiError, type Planning } from "@/lib/api";
import { AutoSaveTextarea } from "@/components/ui/AutoSaveTextarea";
import { GoogleReviewsSection } from "@/components/discovery/ReviewSections";
import { reviewDisplayState } from "@/lib/reviewText";

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="card p-4">
      <h2 className="section-title">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-fg-muted">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{children}</h3>;
}

function ItemList({ heading, items }: { heading: string; items: { text: string; note: string }[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <SubHeading>{heading}</SubHeading>
      <ul className="mt-1.5 space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="rounded-md border border-border p-2 text-sm">
            <p className="text-fg">{item.text}</p>
            <p className="mt-0.5 text-xs text-fg-subtle">{item.note}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Google Review Insights. The reputation/analysis part is the same
 * `GoogleReviewsSection` Discovery's business page uses, so both screens
 * show identical detail, explanations and limitations. Below it sit the
 * Planning-only parts: website opportunities, FAQ topics, review-to-website
 * gaps, and the editable summary. Works independently of the website audit.
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
  const state = reviewDisplayState(review);

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

  const opportunities = planning.review_website_opportunities.map((o) => ({
    text: o.recommendation,
    note: `Based on: ${o.based_on_theme}`,
  }));
  const faqs = planning.review_faq_opportunities.map((f) => ({
    text: f.question,
    note: `Based on: ${f.based_on_theme} · Needs business-owner confirmation`,
  }));
  const gaps = planning.review_website_gaps.map((g) => ({ text: g.gap, note: `Based on: ${g.based_on_theme}` }));
  const hasRecommendations = opportunities.length + faqs.length + gaps.length > 0;

  // The card needs written reviews to be meaningful: show it once the theme
  // analysis can run, or when recommendations are already stored. Never for
  // text-unavailable, small-sample/no-reviews with nothing stored, or a
  // non-ok fetch.
  const showPlanning =
    review !== null && review.data_status === "ok" && (state === "analysed" || hasRecommendations) && state !== "text_unavailable";

  const outcome = planning.review_synthesis_outcome;
  const latestAttemptFailed = outcome === "failed" || outcome === "skipped";
  // After a failed/skipped attempt, any lists still held come from an
  // earlier successful run — say so rather than presenting them as new.
  const staleContent = hasRecommendations && planning.review_synthesis_content_from_latest_attempt === false;

  return (
    <div className="space-y-4">
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

      {review && (
        <Section title="Google reviews">
          <GoogleReviewsSection result={review} />
          {(state === "analysed" || state === "small_sample") && (
            <p className="mt-3 text-xs text-fg-subtle">
              Analysis is based on {review.reviews_with_text} written review{review.reviews_with_text === 1 ? "" : "s"}
              {review.google_review_count !== null && <> of {review.google_review_count} Google reviews in total</>}.
            </p>
          )}
        </Section>
      )}

      {showPlanning && (
        <Section
          title="Website planning from reviews"
          subtitle="Suggestions grounded in the review themes above — for the operator to judge, not verified facts."
        >
          <div className="space-y-4">
            {latestAttemptFailed && (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300" role="status">
                {planning.review_synthesis_outcome_label ??
                  (outcome === "failed" ? "The latest synthesis attempt failed." : "The latest synthesis attempt was skipped.")}
                {outcome === "failed" && planning.review_synthesis_error ? ` ${planning.review_synthesis_error}` : ""}
                {staleContent && " The items below are from an earlier run, not this one."}
              </p>
            )}
            <ItemList heading="Website opportunities" items={opportunities} />
            <ItemList heading="FAQ opportunities" items={faqs} />
            <ItemList heading="Review-to-website gaps" items={gaps} />
            {!hasRecommendations && !latestAttemptFailed && (
              <p className="text-sm text-fg-subtle">
                {planning.review_insights_generated_at
                  ? "No website opportunities, FAQ topics or gaps were identified from the available themes."
                  : "Run Review Insights to generate these."}
              </p>
            )}
            {state === "analysed" && gaps.length === 0 && planning.website_audit_id === null && (
              <p className="text-xs text-fg-subtle">
                Run &ldquo;Analyse Website&rdquo; too, so review gaps can be compared against the current site.
              </p>
            )}
          </div>
        </Section>
      )}

      {review && review.data_status === "ok" && (
        <Section title="Review summary" subtitle="Your editable planning summary — saved automatically.">
          <AutoSaveTextarea
            key={planning.id + (planning.review_insights_generated_at ?? "")}
            defaultValue={planning.review_summary ?? ""}
            onSave={handleSaveReviewSummary}
            rows={3}
          />
        </Section>
      )}
    </div>
  );
}
