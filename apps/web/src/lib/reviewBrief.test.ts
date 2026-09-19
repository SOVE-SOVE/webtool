import { describe, expect, it } from "vitest";
import {
  checklistPercent,
  checklistSummary,
  findingCounts,
  formatRating,
  highestSeverity,
  plural,
  reviewPriority,
  sortFindings,
  topFindings,
} from "./reviewBrief";
import type { ChecklistProgress, QualityFinding, QualityFindingSeverity } from "./api";

function finding(severity: QualityFindingSeverity, message: string, confidence = 0.8): QualityFinding {
  return { category: "seo", severity, message, evidence: "e", confidence };
}

describe("sortFindings", () => {
  it("orders by severity, then confidence, keeping stored order for ties", () => {
    const sorted = sortFindings([
      finding("low", "a"),
      finding("high", "b", 0.5),
      finding("critical", "c"),
      finding("high", "d", 0.9),
      finding("high", "e", 0.5),
    ]);
    expect(sorted.map((f) => f.message)).toEqual(["c", "d", "b", "e", "a"]);
  });

  it("does not mutate its input", () => {
    const input = [finding("low", "a"), finding("critical", "b")];
    sortFindings(input);
    expect(input.map((f) => f.message)).toEqual(["a", "b"]);
  });
});

describe("topFindings", () => {
  it("returns at most two high/critical findings, most severe first", () => {
    const top = topFindings([
      finding("medium", "m"),
      finding("high", "h1"),
      finding("critical", "c"),
      finding("high", "h2", 0.4),
    ]);
    expect(top.map((f) => f.message)).toEqual(["c", "h1"]);
  });

  it("returns a single high finding when only one exists", () => {
    expect(topFindings([finding("low", "l"), finding("high", "h")]).map((f) => f.message)).toEqual(["h"]);
  });

  it("falls back to the one top finding when nothing is high severity", () => {
    expect(topFindings([finding("low", "l"), finding("medium", "m")]).map((f) => f.message)).toEqual(["m"]);
  });

  it("is empty when there are no findings", () => {
    expect(topFindings([])).toEqual([]);
  });

  it("respects a custom limit", () => {
    const list = [finding("high", "a"), finding("high", "b"), finding("high", "c")];
    expect(topFindings(list, 1)).toHaveLength(1);
  });
});

describe("findingCounts / highestSeverity", () => {
  const list = [finding("critical", "a"), finding("high", "b"), finding("high", "c"), finding("low", "d")];

  it("counts each severity and the total", () => {
    expect(findingCounts(list)).toEqual({ total: 4, critical: 1, high: 2, medium: 0, low: 1 });
  });

  it("finds the highest severity, or null for none", () => {
    expect(highestSeverity(list)).toBe("critical");
    expect(highestSeverity([finding("low", "x"), finding("medium", "y")])).toBe("medium");
    expect(highestSeverity([])).toBeNull();
  });
});

describe("reviewPriority", () => {
  it("derives a priority from the score category", () => {
    expect(reviewPriority("hot")?.label).toBe("High");
    expect(reviewPriority("warm")?.label).toBe("Medium");
    expect(reviewPriority("cold")?.label).toBe("Low");
    expect(reviewPriority("review")?.label).toBe("Needs review");
  });

  it("is null when the business has not been scored", () => {
    expect(reviewPriority(null)).toBeNull();
    expect(reviewPriority(undefined)).toBeNull();
  });
});

describe("checklist helpers", () => {
  const progress = (completed: number, total: number): ChecklistProgress => ({
    required: { completed, total, pct: null },
    optional: { completed: 0, total: 0, pct: null },
  });

  it("summarises required progress", () => {
    expect(checklistSummary(progress(2, 5))).toBe("Required: 2 of 5 complete");
    expect(checklistSummary(progress(0, 0))).toBe("No applicable tasks");
  });

  it("computes a rounded percentage, or null with no required tasks", () => {
    expect(checklistPercent(progress(1, 3))).toBe(33);
    expect(checklistPercent(progress(3, 3))).toBe(100);
    expect(checklistPercent(progress(0, 0))).toBeNull();
  });
});

describe("formatting", () => {
  it("pluralises", () => {
    expect(plural(1, "review")).toBe("1 review");
    expect(plural(2, "review")).toBe("2 reviews");
    expect(plural(0, "finding")).toBe("0 findings");
  });

  it("formats a rating line with honest fallbacks", () => {
    expect(formatRating(4.6, 127)).toBe("4.6 ★ · 127 reviews");
    expect(formatRating(null, null)).toBe("No rating · review count unavailable");
    expect(formatRating(5, 1)).toBe("5.0 ★ · 1 review");
  });
});
