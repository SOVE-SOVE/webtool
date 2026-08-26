// Kept out of the page component so it's unit-testable without a DOM —
// same pattern as pipeline.ts/filters.ts (vitest here runs in a plain
// Node environment, no jsdom).
import type { OnboardingCategory, OnboardingCategoryProgress, OnboardingItem } from "./api";

// Human-readable label for a category key, e.g. "target_audience" ->
// "Target audience". A couple of keys read better with a small override
// than a mechanical underscore-to-space conversion would produce.
const CATEGORY_LABEL_OVERRIDES: Partial<Record<OnboardingCategory, string>> = {
  existing_assets: "Existing assets",
  required_pages: "Required pages",
};

export function formatCategoryLabel(category: OnboardingCategory): string {
  const override = CATEGORY_LABEL_OVERRIDES[category];
  if (override) return override;
  const spaced = category.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function groupItemsByCategory(items: OnboardingItem[]): Map<OnboardingCategory, OnboardingItem[]> {
  const grouped = new Map<OnboardingCategory, OnboardingItem[]>();
  for (const item of items) {
    const bucket = grouped.get(item.category);
    if (bucket) bucket.push(item);
    else grouped.set(item.category, [item]);
  }
  return grouped;
}

// Percent complete for one category, over applicable items only — a
// category whose items are all done or not_applicable reads as 100%,
// matching the overall checklist's own percent_complete convention.
export function categoryPercentComplete(progress: OnboardingCategoryProgress): number {
  const applicable = progress.total - progress.not_applicable;
  if (applicable <= 0) return 100;
  return Math.round((100 * progress.done) / applicable);
}
