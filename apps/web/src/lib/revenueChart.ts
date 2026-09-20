/**
 * Pure logic behind the Today overview's cumulative revenue chart: the
 * selectable date ranges, turning the won-deals series into a running
 * total, and the geometry (nice axis ticks, step path, nearest point).
 * Kept out of the component so it's unit-testable without a DOM.
 */

import type { WonDealsSeries } from "./api";

// --- Ranges -----------------------------------------------------------------

export type RevenueRange = "30d" | "90d" | "12m";

export const REVENUE_RANGES: { id: RevenueRange; label: string }[] = [
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
  { id: "12m", label: "12 months" },
];

/** The range the chart opens on — long enough that a small agency's
 * handful of deals per quarter still form a shape. */
export const DEFAULT_REVENUE_RANGE: RevenueRange = "90d";

const DAYS: Record<RevenueRange, number> = { "30d": 30, "90d": 90, "12m": 364 };

function toKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" as a local-midnight Date (never `new Date("YYYY-MM-DD")`, which parses as UTC). */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** The query for a range ending today (inclusive). A year is grouped by week to keep it ~52 points. */
export function rangeQuery(range: RevenueRange, today: Date): { start: string; end: string; groupBy: "day" | "week" } {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (DAYS[range] - 1));
  return { start: toKey(start), end: toKey(today), groupBy: range === "12m" ? "week" : "day" };
}

// --- Cumulative series ------------------------------------------------------

export type RevenuePoint = {
  date: string; // period start, "YYYY-MM-DD"
  dealsCount: number;
  revenueCents: number;
  unpricedCount: number;
  /** Everything won up to and including this period — starts from what was already won before the range. */
  cumulativeCents: number;
};

export function cumulativeRevenue(series: WonDealsSeries): RevenuePoint[] {
  let running = series.prior_revenue_cents;
  return series.points.map((p) => {
    running += p.revenue_cents;
    return {
      date: p.period_start,
      dealsCount: p.deals_count,
      revenueCents: p.revenue_cents,
      unpricedCount: p.unpriced_deals_count,
      cumulativeCents: running,
    };
  });
}

// --- Geometry ---------------------------------------------------------------

const STEP_MULTIPLIERS = [1, 2, 2.5, 5, 10];
/** The axis never collapses below this, so an empty or tiny series still has a sensible scale. */
export const MIN_AXIS_CENTS = 100_000;

/**
 * A y-axis from 0 with clean tick values (in cents): the smallest "nice"
 * step (1/2/2.5/5 × a power of ten) that puts `maxCents` inside at most
 * `targetSteps` steps.
 */
export function niceAxis(maxCents: number, targetSteps = 4): { max: number; ticks: number[] } {
  const raw = Math.max(maxCents, MIN_AXIS_CENTS) / targetSteps;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = (STEP_MULTIPLIERS.find((m) => m * magnitude >= raw) ?? 10) * magnitude;
  const count = Math.ceil(Math.max(maxCents, MIN_AXIS_CENTS) / step);
  return { max: count * step, ticks: Array.from({ length: count + 1 }, (_, i) => i * step) };
}

/** Compact axis label: $0, $250, $1.5k, $12k, $1.2M. */
export function formatAxisCents(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${trim(dollars / 1_000_000)}M`;
  if (dollars >= 1_000) return `$${trim(dollars / 1_000)}k`;
  return `$${Math.round(dollars)}`;
}

function trim(n: number): string {
  return n.toFixed(1).replace(/\.0$/, "");
}

/**
 * A step-after path through the points: a running total only changes on
 * the day a deal lands, so it holds flat between points and jumps
 * straight up at the next one (a slanted line would imply revenue
 * arriving gradually). `closeTo` closes it down to a baseline for the fill.
 */
export function stepPath(xs: number[], ys: number[], closeTo?: number): string {
  if (xs.length === 0) return "";
  let d = `M${xs[0]} ${ys[0]}`;
  for (let i = 1; i < xs.length; i++) d += ` H${xs[i]} V${ys[i]}`;
  if (closeTo !== undefined) d += ` V${closeTo} H${xs[0]} Z`;
  return d;
}

/** Index of the x closest to `px`; -1 for no points. */
export function nearestIndex(xs: number[], px: number): number {
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const distance = Math.abs(xs[i] - px);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

/** Up to `count` evenly spread indices (always including first and last) for x-axis labels. */
export function evenIndices(length: number, count: number): number[] {
  if (length <= 0) return [];
  if (length <= count) return Array.from({ length }, (_, i) => i);
  return Array.from({ length: count }, (_, i) => Math.round((i * (length - 1)) / (count - 1)));
}
