/**
 * Display helpers for the win-rate ring. The rate itself is never
 * computed here — it is `SalesDashboard.conversion_rate_pct` exactly as
 * the API returns it (won / (won + lost), null when nothing has been
 * decided); these only format it and turn it into ring geometry.
 */

/** "62%" — the whole-percent text the dashboard has always shown; "—" when nothing has been decided yet. */
export function formatWinRate(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(0)}%`;
}

/**
 * Stroke geometry for a circular progress ring of radius `r`: the arc's
 * dash length for `value` percent (clamped to 0–100; null counts as 0).
 * `filled` is false for 0%, where a round-capped zero-length arc would
 * still paint a stray dot.
 */
export function winRateRing(value: number | null, r: number): { circumference: number; dash: number; filled: boolean } {
  const circumference = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, value ?? 0));
  return { circumference, dash: (clamped / 100) * circumference, filled: clamped > 0 };
}
