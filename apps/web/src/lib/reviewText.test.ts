import { describe, expect, it } from "vitest";
import { isReviewTextUnavailable, reviewDisplayState } from "./reviewText";

type Fields = Parameters<typeof reviewDisplayState>[0] & object;

const ok: Fields = {
  data_status: "ok",
  google_rating: 4.4,
  google_review_count: 533,
  reviews_with_text: 0,
  themes_data_sufficient: false,
};

describe("reviewDisplayState", () => {
  it("is not_fetched when there is no result", () => {
    expect(reviewDisplayState(null)).toBe("not_fetched");
    expect(reviewDisplayState(undefined)).toBe("not_fetched");
  });

  it("keeps no-listing and failed fetches distinct from missing text", () => {
    expect(reviewDisplayState({ ...ok, data_status: "no_listing", google_rating: null, google_review_count: null })).toBe(
      "no_listing",
    );
    expect(reviewDisplayState({ ...ok, data_status: "unavailable", google_rating: null, google_review_count: null })).toBe(
      "fetch_failed",
    );
  });

  it("is text_unavailable for a successful fetch with a rating, a total count and no written reviews", () => {
    expect(reviewDisplayState(ok)).toBe("text_unavailable");
    expect(isReviewTextUnavailable(ok)).toBe(true);
  });

  it("does not call a business with no Google reviews at all 'text unavailable'", () => {
    expect(reviewDisplayState({ ...ok, google_rating: null, google_review_count: 0 })).toBe("no_google_reviews");
    expect(reviewDisplayState({ ...ok, google_review_count: 0 })).toBe("no_google_reviews");
    expect(reviewDisplayState({ ...ok, google_rating: null, google_review_count: null })).toBe("no_google_reviews");
    expect(isReviewTextUnavailable({ ...ok, google_review_count: 0 })).toBe(false);
  });

  it("treats a small nonzero sample as its own state, not text_unavailable", () => {
    const small = { ...ok, reviews_with_text: 2 };
    expect(reviewDisplayState(small)).toBe("small_sample");
    expect(isReviewTextUnavailable(small)).toBe(false);
  });

  it("is analysed when there is enough written text for themes", () => {
    const enough = { ...ok, reviews_with_text: 5, themes_data_sufficient: true };
    expect(reviewDisplayState(enough)).toBe("analysed");
    expect(isReviewTextUnavailable(enough)).toBe(false);
  });

  it("only flags text_unavailable for a successful fetch", () => {
    expect(isReviewTextUnavailable({ ...ok, data_status: "unavailable" })).toBe(false);
    expect(isReviewTextUnavailable({ ...ok, data_status: "no_listing" })).toBe(false);
    expect(isReviewTextUnavailable(null)).toBe(false);
  });
});
