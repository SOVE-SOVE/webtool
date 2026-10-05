import { describe, expect, it } from "vitest";
import type { Planning, PlanningKeyPoint, Recommendation } from "@/lib/api";
import {
  auditOutcomeNote,
  chooseNextAction,
  countAnalysisStates,
  loadFailureFinding,
  opRowCopy,
  selectKeyFindings,
  shortWaitingLine,
  summariseAnalysisStates,
  summaryExcerpt,
  websiteSummaryView,
} from "./analysisSummary";
import { summariseResearch, type ResearchOp } from "./researchRun";

function point(overrides: Partial<PlanningKeyPoint> = {}): PlanningKeyPoint {
  return {
    area: "technical",
    category: "performance",
    severity: "medium",
    message: "Slow",
    evidence: "4100ms",
    confidence: 0.9,
    ...overrides,
  };
}

describe("countAnalysisStates", () => {
  it("counts done as complete", () => {
    expect(countAnalysisStates(["done", "done"])).toEqual({
      complete: 2,
      running: 0,
      failed: 0,
      unavailable: 0,
      notStarted: 0,
    });
  });

  it("never counts unavailable (or skipped) as complete", () => {
    const counts = countAnalysisStates(["done", "unavailable"]);
    expect(counts.complete).toBe(1);
    expect(counts.unavailable).toBe(1);
  });

  it("counts both needed and waiting as not started", () => {
    expect(countAnalysisStates(["needed", "waiting", "waiting"]).notStarted).toBe(3);
  });

  it("keeps running and failed apart from complete", () => {
    const counts = countAnalysisStates(["running", "failed", "done"]);
    expect(counts).toMatchObject({ running: 1, failed: 1, complete: 1 });
  });
});

describe("summariseAnalysisStates", () => {
  it("reads all-complete plainly", () => {
    expect(summariseAnalysisStates(["done", "done", "done", "done"])).toBe("4 complete");
  });

  it("matches the spec's mixed example", () => {
    expect(summariseAnalysisStates(["done", "unavailable", "done", "needed"])).toBe(
      "2 complete · 1 unavailable · 1 not started",
    );
  });

  it("reports a running operation", () => {
    expect(summariseAnalysisStates(["running", "waiting", "waiting", "waiting"])).toBe("1 running · 3 not started");
  });

  it("reports a partial failure in a fixed order", () => {
    expect(summariseAnalysisStates(["done", "failed", "waiting", "done"])).toBe(
      "2 complete · 1 failed · 1 not started",
    );
  });

  it("reports nothing started yet", () => {
    expect(summariseAnalysisStates(["needed", "waiting", "waiting", "waiting"])).toBe("4 not started");
  });

  it("handles an empty list", () => {
    expect(summariseAnalysisStates([])).toBe("No analysis steps");
  });
});

describe("audit findings vs execution", () => {
  it("finds the load-failure signal only by its availability category", () => {
    expect(loadFailureFinding([point()])).toBeNull();
    const failure = point({ category: "availability", severity: "critical", evidence: "net::ERR_FAILED" });
    expect(loadFailureFinding([point(), failure])).toBe(failure);
  });

  it("says when a completed audit couldn't load the site", () => {
    expect(auditOutcomeNote([point({ category: "availability" })])).toBe("Ran, but the site didn't load");
  });

  it("counts findings rather than implying health", () => {
    expect(auditOutcomeNote([point(), point()])).toBe("2 findings recorded");
    expect(auditOutcomeNote([point()])).toBe("1 finding recorded");
    expect(auditOutcomeNote([])).toBe("No issues recorded");
  });
});

function op(overrides: Partial<ResearchOp> = {}): ResearchOp {
  return { id: "audit", label: "Website audit", state: "done", detail: null, ...overrides };
}

function planning(overrides: Partial<Planning> = {}): Planning {
  return { key_points: [], recommendations: [], assets: [], review_intelligence: null, ...overrides } as Planning;
}

describe("shortWaitingLine", () => {
  it("shortens researchRun's waiting lines", () => {
    expect(shortWaitingLine("Runs after the website audit.")).toBe("After website audit");
    expect(shortWaitingLine("Runs after Google Review Insights.")).toBe("After Google Review Insights");
    expect(shortWaitingLine("Needs the website audit first.")).toBe("Needs website audit first");
  });

  it("keeps anything else as-is", () => {
    expect(shortWaitingLine("Something else.")).toBe("Something else.");
    expect(shortWaitingLine(null)).toBeNull();
  });
});

describe("opRowCopy", () => {
  it("puts a failure's own message behind the disclosure", () => {
    expect(opRowCopy(op({ state: "failed", detail: "Timed out." }), planning())).toEqual({
      short: "Didn't finish",
      more: ["Timed out."],
    });
  });

  it("states the audit outcome, never listing the findings themselves", () => {
    const copy = opRowCopy(op({ detail: "Finished, but part of it needs a look." }), planning({ key_points: [point(), point()] }));
    expect(copy).toEqual({ short: "2 findings recorded", more: ["Finished, but part of it needs a look."] });
  });

  it("isn't expandable when there's nothing beyond the short line", () => {
    expect(opRowCopy(op(), planning()).more).toEqual([]);
    expect(opRowCopy(op({ state: "needed" }), planning())).toEqual({ short: null, more: [] });
  });

  it("keeps an unavailable reason visible and adds the recorded rating", () => {
    const ri = { google_rating: 4, google_review_count: 51 } as Planning["review_intelligence"];
    const copy = opRowCopy(
      op({ id: "reviews", label: "Google Review Insights", state: "unavailable", detail: "No written Google reviews to learn from." }),
      planning({ review_intelligence: ri }),
    );
    expect(copy).toEqual({ short: "No written Google reviews to learn from.", more: ["Google rating 4 from 51 reviews."] });
  });

  it("counts recommendations by category", () => {
    const rec = (category: string) => ({ category }) as Recommendation;
    const copy = opRowCopy(
      op({ id: "recommendations", label: "Recommendations" }),
      planning({ recommendations: [rec("keep"), rec("improve"), rec("improve")] }),
    );
    expect(copy).toEqual({ short: "3 suggestions", more: ["Keep 1 · Improve 2"] });
  });
});

describe("selectKeyFindings", () => {
  it("orders by severity, then confidence, keeping stored order on ties", () => {
    const a = point({ message: "A", severity: "low" });
    const b = point({ message: "B", severity: "high", confidence: 0.5 });
    const c = point({ message: "C", severity: "high", confidence: 0.9 });
    const d = point({ message: "D", severity: "medium" });
    const e = point({ message: "E", severity: "medium" });
    expect(selectKeyFindings([a, b, c, d, e]).map((p) => p.message)).toEqual(["C", "B", "D"]);
    expect(selectKeyFindings([a, d, e], 5).map((p) => p.message)).toEqual(["D", "E", "A"]);
  });

  it("leaves out the load-failure finding and duplicate wording", () => {
    const failure = point({ category: "availability", severity: "critical", message: "Did not load" });
    expect(selectKeyFindings([failure, point({ message: "Slow" }), point({ message: "slow " })]).map((p) => p.message)).toEqual([
      "Slow",
    ]);
  });

  it("returns nothing when there are no findings", () => {
    expect(selectKeyFindings([])).toEqual([]);
  });
});

describe("websiteSummaryView", () => {
  it("passes a genuine summary through", () => {
    expect(websiteSummaryView("  The site is fine.  ")).toEqual({ kind: "summary", text: "The site is fine." });
  });

  it("treats empty as none", () => {
    expect(websiteSummaryView(null)).toEqual({ kind: "none" });
    expect(websiteSummaryView("   ")).toEqual({ kind: "none" });
  });

  it("recognises the audit summary fallback by its exact backend sentence", () => {
    expect(
      websiteSummaryView("No AI provider is configured. The key points below are drawn directly from the audit findings."),
    ).toEqual({ kind: "fallback", reason: "No AI provider is configured." });
  });

  it("recognises the website-plan fallback by its exact backend sentence", () => {
    expect(
      websiteSummaryView("Quota exceeded. No plan could be generated — here is what's on file instead:\nBusiness: X"),
    ).toEqual({ kind: "fallback", reason: "Quota exceeded." });
  });

  it("doesn't guess from other wording", () => {
    expect(websiteSummaryView("Error pages are common on this site.").kind).toBe("summary");
  });
});

describe("summaryExcerpt", () => {
  it("leaves short text whole", () => {
    expect(summaryExcerpt("Short.", 20)).toEqual({ excerpt: "Short.", truncated: false });
  });

  it("cuts at a word boundary with an ellipsis", () => {
    expect(summaryExcerpt("The homepage lacks a clear contact method, and more", 30)).toEqual({
      excerpt: "The homepage lacks a clear…",
      truncated: true,
    });
  });
});

describe("chooseNextAction", () => {
  const ops = (...states: ResearchOp["state"][]): ResearchOp[] =>
    (["audit", "reviews", "recommendations", "details"] as const).map((id, i) => ({
      id,
      label: id === "audit" ? "Website audit" : id === "reviews" ? "Google Review Insights" : id,
      state: states[i],
      detail: null,
    }));
  const pick = (list: ResearchOp[], working = false) => chooseNextAction(list, summariseResearch(list), working);

  it("shows progress while working", () => {
    expect(pick(ops("running", "waiting", "waiting", "waiting"), true)).toEqual({ kind: "running" });
  });

  it("starts or continues remaining work", () => {
    expect(pick(ops("needed", "waiting", "waiting", "waiting"))).toEqual({ kind: "start", label: "Analyse business" });
    expect(pick(ops("done", "needed", "waiting", "needed"))).toEqual({ kind: "start", label: "Continue analysis" });
  });

  it("retries a failed required step", () => {
    expect(pick(ops("failed", "done", "waiting", "done"))).toEqual({
      kind: "retry",
      opId: "audit",
      label: "Retry website audit",
    });
  });

  it("continues when only optional reviews failed", () => {
    expect(pick(ops("done", "failed", "done", "done"))).toEqual({ kind: "continue", label: "Continue to website plan" });
  });

  it("continues once complete, with unavailable counted as settled", () => {
    expect(pick(ops("done", "unavailable", "done", "done"))).toEqual({ kind: "continue", label: "Continue to website plan" });
  });
});
