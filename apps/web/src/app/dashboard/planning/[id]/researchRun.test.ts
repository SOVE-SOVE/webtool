import { describe, expect, it } from "vitest";
import type { Planning } from "@/lib/api";
import { computeResearchOps, nextResearchOp, summariseResearch } from "./researchRun";

// Only the fields researchRun reads — cast once here rather than building
// a full Planning fixture for a pure state machine.
function planning(overrides: Record<string, unknown> = {}): Planning {
  return {
    status: "ready_to_analyse",
    website_url: null,
    website_audit_id: null,
    error_message: null,
    website_plan_generated_at: null,
    review_intelligence: null,
    review_insights_generated_at: null,
    review_synthesis_status: null,
    review_synthesis_error: null,
    recommendations_generated_at: null,
    recommendations: [],
    assets_checklist_generated_at: null,
    ...overrides,
  } as unknown as Planning;
}

const reviewsOk = {
  data_status: "ok",
  google_rating: 4.6,
  google_review_count: 30,
  reviews_with_text: 5,
  themes_data_sufficient: true,
};

const states = (p: Planning, session?: Parameters<typeof computeResearchOps>[1]) =>
  computeResearchOps(p, session).map((op) => `${op.id}:${op.state}`);

describe("computeResearchOps", () => {
  it("gathers business details & assets automatically, once, after the audit/plan settles", () => {
    const settledPlan = planning({ website_plan_generated_at: "2026-09-01T00:00:00Z", recommendations_generated_at: "2026-09-01T00:00:00Z", review_insights_generated_at: "2026-09-01T00:00:00Z", review_intelligence: reviewsOk });
    expect(nextResearchOp(computeResearchOps(settledPlan))).toBe("details");
    const gathered = planning({ ...settledPlan, assets_checklist_generated_at: "2026-09-02T00:00:00Z" } as never);
    expect(computeResearchOps(gathered).at(-1)?.state).toBe("done"); // reused, not re-run
  });

  it("no website: the new-website plan path, never an audit", () => {
    expect(states(planning())).toEqual(["websitePlan:needed", "reviews:waiting", "recommendations:waiting", "details:waiting"]);
    expect(nextResearchOp(computeResearchOps(planning()))).toBe("websitePlan");
  });

  it("with a website: audit first, then reviews, then recommendations", () => {
    const p = planning({ website_url: "https://example.com" });
    expect(states(p)).toEqual(["audit:needed", "reviews:waiting", "recommendations:waiting", "details:waiting"]);
  });

  it("while the audit job runs, nothing else starts (no duplicate requests)", () => {
    const ops = computeResearchOps(planning({ website_url: "https://x.test", status: "analysing" }));
    expect(ops[0].state).toBe("running");
    expect(nextResearchOp(ops)).toBeNull();
    expect(summariseResearch(ops).hasRemaining).toBe(true);
  });

  it("reuses existing successful results — only the missing step is next", () => {
    const p = planning({
      website_url: "https://x.test",
      status: "completed",
      website_audit_id: "a1",
      review_insights_generated_at: "2026-09-01T00:00:00Z",
      review_intelligence: reviewsOk,
      review_synthesis_status: "completed",
    });
    expect(states(p)).toEqual(["audit:done", "reviews:done", "recommendations:needed", "details:needed"]);
    expect(nextResearchOp(computeResearchOps(p))).toBe("recommendations");
  });

  it("partial failure: failed reviews offer a retry but don't block recommendations", () => {
    const p = planning({
      website_url: "https://x.test",
      status: "completed",
      website_audit_id: "a1",
      review_insights_generated_at: "2026-09-01T00:00:00Z",
      review_intelligence: reviewsOk,
      review_synthesis_status: "failed",
      review_synthesis_error: "The AI response wasn't in the expected format.",
    });
    const ops = computeResearchOps(p);
    expect(states(p)).toEqual(["audit:done", "reviews:failed", "recommendations:needed", "details:needed"]);
    expect(nextResearchOp(ops)).toBe("recommendations");
    expect(summariseResearch(ops).failed.map((o) => o.id)).toEqual(["reviews"]);
  });

  it("a failed audit stops recommendations but still lets reviews run, and never reads as complete", () => {
    const p = planning({ website_url: "https://x.test", status: "failed", error_message: "Couldn't reach the site." });
    expect(states(p)).toEqual(["audit:failed", "reviews:needed", "recommendations:waiting", "details:needed"]);
    const after = planning({
      website_url: "https://x.test",
      status: "failed",
      review_insights_generated_at: "2026-09-01T00:00:00Z",
      review_intelligence: { ...reviewsOk, data_status: "no_listing" },
      assets_checklist_generated_at: "2026-09-01T00:00:00Z",
    });
    const progress = summariseResearch(computeResearchOps(after));
    expect(progress.complete).toBe(false);
    expect(progress.hasRemaining).toBe(false); // nothing runnable until the audit is retried
    expect(nextResearchOp(computeResearchOps(after))).toBeNull();
  });

  it("no Google listing is 'unavailable', not a failure, and doesn't block", () => {
    const p = planning({
      website_plan_generated_at: "2026-09-01T00:00:00Z",
      review_insights_generated_at: "2026-09-01T00:00:00Z",
      review_intelligence: { ...reviewsOk, data_status: "no_listing" },
    });
    expect(states(p)).toEqual(["websitePlan:done", "reviews:unavailable", "recommendations:needed", "details:needed"]);
  });

  it("a session error on a sync step shows as failed until retried", () => {
    const p = planning({ website_plan_generated_at: "2026-09-01T00:00:00Z" });
    const ops = computeResearchOps(p, { errors: { reviews: "Rate limit reached." }, unavailable: {} });
    expect(ops[1]).toMatchObject({ id: "reviews", state: "failed", detail: "Rate limit reached." });
  });

  it("everything done reads complete", () => {
    const p = planning({
      website_plan_generated_at: "2026-09-01T00:00:00Z",
      review_insights_generated_at: "2026-09-01T00:00:00Z",
      review_intelligence: reviewsOk,
      review_synthesis_status: "completed",
      recommendations_generated_at: "2026-09-01T00:00:00Z",
      assets_checklist_generated_at: "2026-09-01T00:00:00Z",
    });
    expect(summariseResearch(computeResearchOps(p))).toMatchObject({ complete: true, done: 4, total: 4 });
  });
});
