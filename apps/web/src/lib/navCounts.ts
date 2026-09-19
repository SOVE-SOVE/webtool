/**
 * A tiny module-level cache for the two sidebar badge counts — items
 * waiting in the Review queue, and Planning items needing review. Same
 * pattern as lib/overview.ts's cache for GET /dashboard/overview: the
 * sidebar is mounted on every page, so without a shared short-lived
 * cache these two list endpoints would refire on every navigation.
 *
 * The review count comes from the paged Review Queue endpoint's
 * whole-queue `tab_counts` (a one-row page, so the queue itself is never
 * downloaded); the planning count is derived client-side from its list
 * endpoint — real workspace data, not invented metrics.
 *
 * The raw `listPlanning()` array behind `planningNeedsReview` is also
 * cached here (via `peekPlanningItems`) so the background activity
 * panel can reuse this same fetch instead of issuing its own — one
 * network call site serving the sidebar badge, the Today dashboard,
 * and the activity panel.
 */

// Relative import so this stays runnable under vitest (no path-alias
// config there) — same as lib/overview.ts.
import { api, type PlanningListItem } from "./api";

export type NavCounts = {
  reviewQueue: number;
  planningNeedsReview: number;
};

/** "Waiting in the queue" = still to decide (needs review) or approved
 * but not yet imported; imported/rejected/archived are already decided. */
export function waitingInReviewQueue(tabCounts: Record<string, number>): number {
  return (tabCounts.needs_review ?? 0) + (tabCounts.approved ?? 0);
}

const FRESH_MS = 30_000;

let cache: { at: number; data: NavCounts } | null = null;
let planningItemsCache: PlanningListItem[] | null = null;
let inflight: Promise<NavCounts> | null = null;

async function fetchNavCounts(): Promise<NavCounts> {
  const [reviewPage, planningItems] = await Promise.all([
    api.listReviewQueuePage({ tab: "all", page: 1, pageSize: 1 }),
    api.listPlanning(),
  ]);
  planningItemsCache = planningItems;
  return {
    reviewQueue: waitingInReviewQueue(reviewPage.tab_counts),
    planningNeedsReview: planningItems.filter((item) => item.status === "needs_review").length,
  };
}

export function loadNavCounts(opts?: { force?: boolean }): Promise<NavCounts> {
  if (!opts?.force && cache && Date.now() - cache.at < FRESH_MS) {
    return Promise.resolve(cache.data);
  }
  if (inflight) return inflight;
  inflight = fetchNavCounts()
    .then((data) => {
      cache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** The last cached result, if any — for a no-flash initial render. */
export function peekNavCounts(): NavCounts | null {
  return cache?.data ?? null;
}

/** The raw planning-items array behind the cached counts, if any. */
export function peekPlanningItems(): PlanningListItem[] | null {
  return planningItemsCache;
}

/** Drop the cache so the next `loadNavCounts()` refetches. */
export function invalidateNavCounts(): void {
  cache = null;
}
