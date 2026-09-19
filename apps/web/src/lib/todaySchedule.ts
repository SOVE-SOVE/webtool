/**
 * Feeds for the compact month calendar on the Today dashboard
 * (`TaskScheduleCalendar`), built from data Today already loads rather
 * than a new endpoint.
 *
 * - **Task events** (amber): the due date of every open task.
 * - **Client-calendar events** (blue): meetings belonging to a client —
 *   held against one of a client's projects, or against the lead the
 *   client converted from — plus, via `clientScheduleEvents`, the open
 *   tasks filed under those projects/leads. A task can therefore arrive
 *   from both feeds; the widget's `indexScheduleByDay` keeps it once,
 *   under the task source, so a day never gets a duplicate marker.
 *
 * Prospect projects (no client yet) and meetings that aren't tied to a
 * client are deliberately left off the client calendar; their tasks still
 * show in the task feed. The full Calendar page remains the place for the
 * whole workspace.
 */

import type { Meeting, Project, Task } from "./api";
import { clientScheduleEvents, taskScheduleEvents, type ScheduleEvent } from "./taskSchedule";

type TaskInput = Pick<Task, "id" | "title" | "done" | "due_at" | "project_id" | "lead_id">;
type MeetingInput = Pick<Meeting, "id" | "title" | "status" | "scheduled_at" | "project_id" | "lead_id">;
type ProjectInput = Pick<Project, "id" | "client_id" | "source_lead_id">;

export function todayScheduleFeeds({
  tasks,
  meetings,
  projects,
}: {
  tasks: TaskInput[];
  meetings: MeetingInput[];
  projects: ProjectInput[];
}): { taskEvents: ScheduleEvent[]; clientEvents: ScheduleEvent[] } {
  const taskEvents = tasks.filter((t) => !t.done).flatMap((t) => taskScheduleEvents(t));

  const owned = projects.filter((p) => p.client_id !== null);
  const projectIds = owned.map((p) => p.id);
  const leadIds = owned.flatMap((p) => (p.source_lead_id ? [p.source_lead_id] : []));
  const projectSet = new Set(projectIds);
  const leadSet = new Set(leadIds);

  const clientMeetings = meetings.filter(
    (m) => (m.project_id !== null && projectSet.has(m.project_id)) || (m.lead_id !== null && leadSet.has(m.lead_id)),
  );

  const clientEvents = clientScheduleEvents({ scope: { projectIds, leadIds }, tasks, meetings: clientMeetings });
  return { taskEvents, clientEvents };
}
