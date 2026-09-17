/**
 * Pure date-grid math shared by every calendar surface in this app —
 * originally inlined in `dashboard/calendar/page.tsx`, pulled out here
 * so the Revenue calendar reuses the exact same day-grid logic instead
 * of a second, slightly-different implementation. Kept dependency-free
 * (no date library) — the grids only ever need whole-day arithmetic.
 */

/** "YYYY-MM-DD" in local time — the same key shape `due_date`/
 * `received_date` already use everywhere else in this app, so a grid
 * cell's key always matches a record's own date field directly. */
export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Parses an ISO "YYYY-MM-DD" date string as a local-time Date — same
 * construction `formatDate` already uses, deliberately not `new
 * Date(iso)` (which parses as UTC midnight and can land on the wrong
 * local day). Every obligation/transaction date in this app is a plain
 * calendar date with no time-of-day component, so this is the one
 * correct way to place one on a grid. */
export function isoToLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Full weeks (Sun-start) covering the given month — always 42 cells
 * (6 full weeks), so days from the adjacent month that share a row are
 * included too and still get their events shown. Same behaviour the
 * standalone Calendar page already had. */
export function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - first.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

/** One Sun-start week (7 cells) containing `anchor`. */
export function weekGrid(anchor: Date): Date[] {
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - anchor.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export function addWeeks(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n * 7);
}

export type CalendarGridMode = "month" | "week";

/**
 * The *reporting* period for a cursor+grid — the calendar month proper
 * (1st → last day), or the Sun→Sat week. Deliberately NOT the 42-cell
 * month grid's own first/last day: that grid pads with a few days of
 * the adjacent months to square off its weeks, and summing those into
 * a figure labelled "September 2026" would make the label a lie. The
 * padding cells still render (dimmed, as days that aren't part of this
 * month) — they just aren't part of what the period's totals count.
 *
 * `calendarRangeLabel` describes exactly this range, so a financial
 * figure and the words next to it can never drift apart.
 */
export function calendarPeriodBounds(cursor: Date, grid: CalendarGridMode): { start: string; end: string } {
  if (grid === "week") {
    const days = weekGrid(cursor);
    return { start: toDateKey(days[0]), end: toDateKey(days[6]) };
  }
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  return { start: toDateKey(first), end: toDateKey(last) };
}

/** Human-readable heading for a cursor+grid — "September 2026" for a
 * month, or an explicit "14 Sep – 20 Sep 2026" for a week, which has
 * no single name. Describes exactly the range `calendarPeriodBounds`
 * returns. */
export function calendarRangeLabel(cursor: Date, grid: CalendarGridMode): string {
  if (grid === "month") return cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const days = weekGrid(cursor);
  return `${days[0].toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${days[6].toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}
