/**
 * Pure logic behind `TaskScheduleCalendar`: normalising a schedule item's
 * date to a grid key, laying out only the weeks a month actually needs,
 * and bucketing the two event sources (the task's own dates, and its
 * linked client's calendar) by day. Kept out of the component so it's
 * unit-testable — same pattern as tasks.ts / calendarGrid.ts.
 */

import { monthGrid, toDateKey } from "./calendarGrid";

/**
 * One dated item, already normalised by the caller. `id` is the
 * underlying record's identity (e.g. `task:<uuid>` / `meeting:<uuid>`) —
 * it is what lets the same item arriving from both sources be shown
 * once instead of twice.
 */
export type ScheduleEvent = {
  id: string;
  title: string;
  /** ISO datetime, or a plain "YYYY-MM-DD" calendar date. */
  at: string;
};

export type DaySchedule = {
  task: ScheduleEvent[];
  client: ScheduleEvent[];
};

const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The grid key a schedule item lands on. A plain date is used as-is (it
 * has no time-of-day, so parsing it as a Date would risk shifting it a
 * day); a datetime is placed on the *local* day, the same way the full
 * calendar page places its events.
 */
export function scheduleDateKey(at: string): string | null {
  if (PLAIN_DATE.test(at)) return at;
  const parsed = new Date(at);
  return Number.isNaN(parsed.getTime()) ? null : toDateKey(parsed);
}

/**
 * The days to draw for a month: whole Sun-start weeks, but only the
 * weeks the month actually touches (4–6 rows) rather than the full
 * calendar page's fixed 42 cells — a compact widget shouldn't reserve a
 * blank sixth row.
 */
export function compactMonthCells(year: number, month: number): Date[] {
  const leading = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeks = Math.ceil((leading + daysInMonth) / 7);
  return monthGrid(year, month).slice(0, weeks * 7);
}

/**
 * Buckets both sources by day. An item whose `id` appears in both
 * sources (e.g. the current task's own due date, which also shows up in
 * the client's calendar feed) is kept once, under the task source, so a
 * day never gets a duplicate marker or a duplicate title. Duplicate ids
 * within a single source are dropped the same way. Items with an
 * unparseable date are skipped.
 */
export function indexScheduleByDay(
  taskEvents: ScheduleEvent[],
  clientEvents: ScheduleEvent[],
): Map<string, DaySchedule> {
  const byDay = new Map<string, DaySchedule>();
  const seen = new Set<string>();

  const add = (source: keyof DaySchedule, events: ScheduleEvent[]) => {
    for (const event of events) {
      if (seen.has(event.id)) continue;
      const key = scheduleDateKey(event.at);
      if (key === null) continue;
      seen.add(event.id);
      let day = byDay.get(key);
      if (!day) {
        day = { task: [], client: [] };
        byDay.set(key, day);
      }
      day[source].push(event);
    }
  };

  add("task", taskEvents);
  add("client", clientEvents);
  return byDay;
}
