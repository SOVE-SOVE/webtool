/**
 * A tiny module-level cache for the two sidebar badge counts — items
 * waiting in the Review queue, and Planning items needing review. Same
 * pattern as lib/overview.ts's cache for GET /dashboard/overview: the
 * sidebar is mounted on every page, so without a shared short-lived
 * cache these two list endpoints would refire on every navigation.
 *
 * Both counts are derived client-side from existing list endpoints
 * (no new backend routes) — real workspace data, not invented metrics.
 */

// Relative import so this stays runnable under vitest (no path-alias
// config there) — same as lib/overview.ts.
import { api } from "./api";

export type NavCounts = {
  reviewQueue: number;
  planningNeedsReview: number;
};

// A discovered business that has already been decided on isn't "waiting
// in the queue" any more, whether or not it's archived.
const DECIDED_STATUSES = new Set(["imported", "rejected", "archived"]);

const FRESH_MS = 30_000;

let cache: { at: number; data: NavCounts } | null = null;
let inflight: Promise<NavCounts> | null = null;

async function fetchNavCounts(): Promise<NavCounts> {
  const [reviewItems, planningItems] = await Promise.all([api.listReviewItems(), api.listPlanning()]);
  return {
    reviewQueue: reviewItems.filter((item) => !DECIDED_STATUSES.has(item.status)).length,
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

/** Drop the cache so the next `loadNavCounts()` refetches. */
export function invalidateNavCounts(): void {
  cache = null;
}
