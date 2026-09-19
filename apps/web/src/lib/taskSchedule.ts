/**
 * Pure logic behind `TaskScheduleCalendar`: normalising a schedule item's
 * date to a grid key, laying out only the weeks a month actually needs,
 * and bucketing the two event sources (the task's own dates, and its
 * linked client's calendar) by day. Kept out of the component so it's
 * unit-testable — same pattern as tasks.ts / calendarGrid.ts.
 */

import type { Meeting, Project, Task } from "./api";
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

// --- Wiring a task to its client's calendar --------------------------------
//
// A task belongs to a project or a lead, never to a client directly, and
// no API returns "a client's calendar". These helpers derive the client
// from what the Tasks page already has loaded and shape the pieces the
// widget needs.

type TaskLike = Pick<Task, "id" | "title" | "done" | "due_at" | "project_id" | "lead_id">;
type ProjectLike = Pick<Project, "id" | "client_id" | "source_lead_id">;
type MeetingLike = Pick<Meeting, "id" | "title" | "status" | "scheduled_at">;

/**
 * The client a task is linked to, or null. A project task follows its
 * project's `client_id` (null for a prospect project). A lead task has no
 * client until that lead converts, at which point the lead's project is
 * re-pointed at the new client (`source_lead_id` is kept) — so that
 * project is how a converted lead's tasks find their client.
 */
export function resolveTaskClientId(
  task: Pick<Task, "project_id" | "lead_id">,
  projects: ProjectLike[],
): string | null {
  if (task.project_id) return projects.find((p) => p.id === task.project_id)?.client_id ?? null;
  if (task.lead_id) {
    return projects.find((p) => p.source_lead_id === task.lead_id && p.client_id)?.client_id ?? null;
  }
  return null;
}

/** Every project and originating lead that belongs to a client. */
export function clientScope(
  clientId: string,
  projects: ProjectLike[],
): { projectIds: string[]; leadIds: string[] } {
  const owned = projects.filter((p) => p.client_id === clientId);
  return {
    projectIds: owned.map((p) => p.id),
    leadIds: owned.flatMap((p) => (p.source_lead_id ? [p.source_lead_id] : [])),
  };
}

/** The task's own dated items. Only `due_at` exists on a task today. */
export function taskScheduleEvents(task: Pick<Task, "id" | "title" | "due_at">): ScheduleEvent[] {
  return task.due_at ? [{ id: `task:${task.id}`, title: task.title, at: task.due_at }] : [];
}

/**
 * The linked client's calendar: meetings (cancelled ones are dropped —
 * they're not happening) and the due dates of open tasks filed under the
 * client's projects or originating leads. Meetings fetched once per
 * project and once per lead can overlap, so they're deduped by id. The
 * current task is *not* excluded here on purpose: it shares an id with the
 * task source and `indexScheduleByDay` collapses the two.
 */
export function clientScheduleEvents({
  scope,
  tasks,
  meetings,
}: {
  scope: { projectIds: string[]; leadIds: string[] };
  tasks: TaskLike[];
  meetings: MeetingLike[];
}): ScheduleEvent[] {
  const events: ScheduleEvent[] = [];
  const seen = new Set<string>();

  for (const m of meetings) {
    const id = `meeting:${m.id}`;
    if (m.status === "cancelled" || seen.has(id)) continue;
    seen.add(id);
    events.push({ id, title: m.title, at: m.scheduled_at });
  }
  for (const t of tasks) {
    if (t.done || !t.due_at) continue;
    const inScope =
      (t.project_id !== null && scope.projectIds.includes(t.project_id)) ||
      (t.lead_id !== null && scope.leadIds.includes(t.lead_id));
    if (!inScope) continue;
    events.push({ id: `task:${t.id}`, title: `Due: ${t.title}`, at: t.due_at });
  }
  return events;
}
