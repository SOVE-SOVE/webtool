/**
 * Follow-ups page helpers. Pure + unit-tested (same pattern as
 * leads.ts / pipeline.ts / filters.ts), kept out of the page component.
 *
 * The Follow-ups page has two data sources: `FollowUpBuckets` (already
 * scheduled, split into overdue / due today / upcoming) and
 * `FollowUpCandidate[]` (leads the detector thinks have gone quiet with
 * nothing scheduled). "The queue is empty" means both are empty — that's
 * when the page shows a single explanatory empty state instead of a
 * wall of empty sections.
 */

import type { FollowUpBuckets, FollowUpCandidate } from "@/lib/api";

/** Total number of scheduled follow-ups across all three buckets. */
export function scheduledFollowUpCount(buckets: FollowUpBuckets | null): number {
  if (!buckets) return 0;
  return buckets.overdue.length + buckets.due_today.length + buckets.upcoming.length;
}

/**
 * True when there is nothing for the operator to act on — no scheduled
 * follow-ups and no detected candidates. Drives the page's empty state.
 * `null` buckets (not loaded / failed to load) count as empty here; the
 * page only reaches the empty state once a load has succeeded.
 */
export function isFollowUpQueueEmpty(
  buckets: FollowUpBuckets | null,
  candidates: FollowUpCandidate[],
): boolean {
  return scheduledFollowUpCount(buckets) === 0 && candidates.length === 0;
}

/**
 * Display name for a follow-up / candidate row. The backend always
 * attaches a lead and a business, but a business can be saved with a
 * blank name — show a clear placeholder rather than an empty, clickable
 * gap.
 */
export function followUpBusinessLabel(item: { business_name?: string | null }): string {
  const name = item.business_name?.trim();
  return name && name.length > 0 ? name : "Unnamed business";
}
