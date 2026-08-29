/**
 * A tiny module-level cache for GET /api/v1/dashboard/overview.
 *
 * Two things read that (fairly heavy) aggregate: the Overview page's
 * summary metrics, and the <DoThisNext> queue the dashboard layout
 * renders on every page. Without a shared cache the Overview page would
 * fire it twice on load, and navigating between any two pages would
 * re-run it every time. This keeps one result warm for a short window;
 * a genuine revisit after that window still refetches, and a mutation
 * elsewhere can force it with `invalidateOverview()`.
 */

// Relative (not "@/lib/api") so this stays runnable under vitest, which
// has no path-alias config — same as api.test.ts's own imports.
import { api, type DashboardOverview } from "./api";

const FRESH_MS = 20_000;

let cache: { at: number; data: DashboardOverview } | null = null;
let inflight: Promise<DashboardOverview> | null = null;

export function loadOverview(opts?: { force?: boolean }): Promise<DashboardOverview> {
  if (!opts?.force && cache && Date.now() - cache.at < FRESH_MS) {
    return Promise.resolve(cache.data);
  }
  if (inflight) return inflight;
  inflight = api
    .dashboardOverview()
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
export function peekOverview(): DashboardOverview | null {
  return cache?.data ?? null;
}

/** Drop the cache so the next `loadOverview()` refetches. */
export function invalidateOverview(): void {
  cache = null;
}
