import type { ReviewIntelligenceResult } from "@/lib/api";

/**
 * Shown wherever the Google review analysis has a rating and a review
 * count but no written review text. Google's Place Details can return the
 * aggregate figures without any individual reviews; the cause of that is
 * unresolved, so this states only what the latest fetch actually returned.
 */
export const REVIEW_TEXT_UNAVAILABLE_MESSAGE =
  "Written reviews weren’t returned in the latest fetch. Google provided a rating and review count, but there is no review text available to identify themes or recommend website changes.";

/** Shown alongside the message next to any Run/Refresh action — refreshing
 * re-checks Google, it does not promise written reviews will come back. */
export const REVIEW_TEXT_REFRESH_NOTE =
  "Refreshing checks Google again, but it may return the same result.";

/**
 * What the review analysis can honestly show. Derived only from fields
 * already on `ReviewIntelligenceResult`:
 *
 * - `not_fetched`        — no result yet (the caller separately handles "loading").
 * - `no_listing`         — no Google listing on record.
 * - `fetch_failed`       — the request to Google failed / is unconfigured.
 * - `no_google_reviews`  — fetch succeeded but the business has no rating or a total of 0.
 * - `text_unavailable`   — fetch succeeded, Google reports reviews in total, none came back written.
 * - `small_sample`       — some written reviews, but too few to identify themes.
 * - `analysed`           — enough written reviews for the theme analysis to run.
 */
export type ReviewDisplayState =
  | "not_fetched"
  | "no_listing"
  | "fetch_failed"
  | "no_google_reviews"
  | "text_unavailable"
  | "small_sample"
  | "analysed";

type ReviewFields = Pick<
  ReviewIntelligenceResult,
  "data_status" | "google_rating" | "google_review_count" | "reviews_with_text" | "themes_data_sufficient"
>;

export function reviewDisplayState(result: ReviewFields | null | undefined): ReviewDisplayState {
  if (!result) return "not_fetched";
  if (result.data_status === "no_listing") return "no_listing";
  if (result.data_status === "unavailable") return "fetch_failed";
  if (result.google_rating === null || !result.google_review_count) return "no_google_reviews";
  if (result.reviews_with_text === 0) return "text_unavailable";
  return result.themes_data_sufficient ? "analysed" : "small_sample";
}

/** A successful fetch that reported reviews in total but returned no written review. */
export function isReviewTextUnavailable(result: ReviewFields | null | undefined): boolean {
  return reviewDisplayState(result) === "text_unavailable";
}
