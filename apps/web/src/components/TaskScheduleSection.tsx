"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type Meeting, type Task } from "@/lib/api";
import { TaskScheduleCalendar } from "@/components/TaskScheduleCalendar";
import {
  clientScheduleEvents,
  clientScope,
  resolveTaskClientId,
  taskScheduleEvents,
} from "@/lib/taskSchedule";

type ClientCalendar =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; hasClient: false }
  | { status: "ready"; hasClient: true; projectIds: string[]; leadIds: string[]; meetings: Meeting[] };

/**
 * The "Schedule" block on a task's detail: the task's own due date
 * alongside its linked client's calendar, on one compact month grid.
 *
 * The task's own dates render immediately; the client half loads after
 * (projects → the client → that client's meetings), because no API
 * returns a client's calendar directly. Meetings are fetched per project
 * and per originating lead (a converted client's pre-sale calls live on
 * the lead) instead of pulling every meeting in the workspace. Other
 * tasks under the client come from `tasks`, which the Tasks page already
 * holds, so they stay in step with edits without another request.
 *
 * Mount it with `key={task.id}`: the load state starts at "loading" and is
 * only ever advanced by the effect, so a different task needs a fresh instance.
 */
export function TaskScheduleSection({ task, tasks }: { task: Task; tasks: Task[] }) {
  const { project_id: projectId, lead_id: leadId } = task;
  const [calendar, setCalendar] = useState<ClientCalendar>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const projects = await api.listProjects();
        const clientId = resolveTaskClientId({ project_id: projectId, lead_id: leadId }, projects);
        if (clientId === null) {
          if (!cancelled) setCalendar({ status: "ready", hasClient: false });
          return;
        }
        const { projectIds, leadIds } = clientScope(clientId, projects);
        const lists = await Promise.all([
          ...projectIds.map((id) => api.listMeetings({ projectId: id })),
          ...leadIds.map((id) => api.listMeetings({ leadId: id })),
        ]);
        if (!cancelled) {
          setCalendar({ status: "ready", hasClient: true, projectIds, leadIds, meetings: lists.flat() });
        }
      } catch {
        if (!cancelled) setCalendar({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, leadId]);

  const taskEvents = useMemo(() => taskScheduleEvents(task), [task]);
  const clientEvents = useMemo(
    () =>
      calendar.status === "ready" && calendar.hasClient
        ? clientScheduleEvents({
            scope: { projectIds: calendar.projectIds, leadIds: calendar.leadIds },
            tasks,
            meetings: calendar.meetings,
          })
        : [],
    [calendar, tasks],
  );

  const hasClient = calendar.status === "ready" && calendar.hasClient;
  let note: string | null = null;
  if (calendar.status === "loading") note = "Loading client calendar…";
  else if (calendar.status === "error") note = "Couldn't load the client's calendar.";
  else if (!hasClient) note = "Not linked to a client yet, so only this task's dates are shown.";
  else if (taskEvents.length === 0) note = "This task has no due date.";

  return (
    <section className="mt-4 border-t border-border pt-4" aria-labelledby="task-schedule-heading">
      <h3 id="task-schedule-heading" className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">
        Schedule
      </h3>
      <TaskScheduleCalendar taskEvents={taskEvents} clientEvents={clientEvents} showClientLegend={hasClient} />
      {note && (
        <p className="mt-1.5 text-[11px] text-fg-subtle" role="status">
          {note}
        </p>
      )}
    </section>
  );
}
