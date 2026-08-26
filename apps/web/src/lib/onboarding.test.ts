import { describe, expect, it } from "vitest";
import type { OnboardingCategoryProgress, OnboardingItem } from "./api";
import { categoryPercentComplete, formatCategoryLabel, groupItemsByCategory } from "./onboarding";

function item(overrides: Partial<OnboardingItem> = {}): OnboardingItem {
  return {
    id: "item-1",
    project_id: "project-1",
    category: "domain",
    label: "Confirm the domain",
    status: "pending",
    notes: null,
    is_custom: false,
    sort_order: 0,
    created_at: "2026-08-26T00:00:00Z",
    ...overrides,
  } as OnboardingItem;
}

function progress(overrides: Partial<OnboardingCategoryProgress> = {}): OnboardingCategoryProgress {
  return {
    category: "domain",
    total: 0,
    done: 0,
    not_applicable: 0,
    complete: false,
    ...overrides,
  } as OnboardingCategoryProgress;
}

describe("formatCategoryLabel", () => {
  it("title-cases a plain snake_case category", () => {
    expect(formatCategoryLabel("branding")).toBe("Branding");
    expect(formatCategoryLabel("target_audience")).toBe("Target audience");
  });

  it("uses the curated override for a category that reads awkwardly mechanically", () => {
    expect(formatCategoryLabel("existing_assets")).toBe("Existing assets");
    expect(formatCategoryLabel("required_pages")).toBe("Required pages");
  });
});

describe("groupItemsByCategory", () => {
  it("groups items into buckets keyed by category, preserving order", () => {
    const items = [
      item({ id: "a", category: "domain" }),
      item({ id: "b", category: "hosting" }),
      item({ id: "c", category: "domain" }),
    ];
    const grouped = groupItemsByCategory(items);
    expect([...grouped.keys()]).toEqual(["domain", "hosting"]);
    expect(grouped.get("domain")?.map((i) => i.id)).toEqual(["a", "c"]);
    expect(grouped.get("hosting")?.map((i) => i.id)).toEqual(["b"]);
  });

  it("returns an empty map for no items", () => {
    expect(groupItemsByCategory([]).size).toBe(0);
  });
});

describe("categoryPercentComplete", () => {
  it("is 0 when nothing is done", () => {
    expect(categoryPercentComplete(progress({ total: 2, done: 0 }))).toBe(0);
  });

  it("is 100 when every item is done", () => {
    expect(categoryPercentComplete(progress({ total: 2, done: 2 }))).toBe(100);
  });

  it("ignores not_applicable items in the denominator", () => {
    // 1 done, 1 not_applicable, 2 total -> 1/1 applicable = 100%.
    expect(categoryPercentComplete(progress({ total: 2, done: 1, not_applicable: 1 }))).toBe(100);
  });

  it("is 100 for a category with zero items rather than dividing by zero", () => {
    expect(categoryPercentComplete(progress({ total: 0, done: 0 }))).toBe(100);
  });

  it("rounds to the nearest whole percent", () => {
    expect(categoryPercentComplete(progress({ total: 3, done: 1 }))).toBe(33);
  });
});
