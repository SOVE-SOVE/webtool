import { describe, expect, it } from "vitest";
import { todayScheduleFeeds } from "./todaySchedule";
import { indexScheduleByDay } from "./taskSchedule";

function task(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Task ${id}`,
    done: false,
    due_at: "2026-09-20T09:00:00.000Z",
    project_id: null as string | null,
    lead_id: null as string | null,
    ...overrides,
  };
}

function meeting(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Meeting ${id}`,
    status: "scheduled" as const,
    scheduled_at: "2026-09-22T01:00:00.000Z",
    project_id: null as string | null,
    lead_id: null as string | null,
    ...overrides,
  };
}

const projects = [
  { id: "p-client", client_id: "c1", source_lead_id: "l-converted" },
  { id: "p-prospect", client_id: null, source_lead_id: "l-prospect" },
];

describe("todayScheduleFeeds", () => {
  it("puts every open task with a due date in the task feed", () => {
    const { taskEvents } = todayScheduleFeeds({
      tasks: [task("a"), task("b", { done: true }), task("c", { due_at: null })],
      meetings: [],
      projects,
    });
    expect(taskEvents).toEqual([{ id: "task:a", title: "Task a", at: "2026-09-20T09:00:00.000Z" }]);
  });

  it("keeps only client meetings — by project or by converted lead — in the client feed", () => {
    const { clientEvents } = todayScheduleFeeds({
      tasks: [],
      meetings: [
        meeting("on-project", { project_id: "p-client" }),
        meeting("on-lead", { lead_id: "l-converted" }),
        meeting("prospect", { project_id: "p-prospect" }),
        meeting("prospect-lead", { lead_id: "l-prospect" }),
        meeting("loose"),
      ],
      projects,
    });
    expect(clientEvents.map((e) => e.id).sort()).toEqual(["meeting:on-lead", "meeting:on-project"]);
  });

  it("drops cancelled meetings", () => {
    const { clientEvents } = todayScheduleFeeds({
      tasks: [],
      meetings: [meeting("x", { project_id: "p-client", status: "cancelled" })],
      projects,
    });
    expect(clientEvents).toEqual([]);
  });

  it("shows a client task once, under the task source, not as a second marker", () => {
    const feeds = todayScheduleFeeds({
      tasks: [task("t1", { project_id: "p-client" }), task("t2", { project_id: "p-prospect" })],
      meetings: [meeting("m1", { project_id: "p-client", scheduled_at: "2026-09-20T02:00:00.000Z" })],
      projects,
    });
    // The client feed also carries t1 (it is filed under a client project)…
    expect(feeds.clientEvents.map((e) => e.id)).toContain("task:t1");
    // …but the widget collapses it into the task source.
    const days = [...indexScheduleByDay(feeds.taskEvents, feeds.clientEvents).values()];
    const allTaskIds = days.flatMap((d) => d.task.map((e) => e.id));
    const allClientIds = days.flatMap((d) => d.client.map((e) => e.id));
    expect(allTaskIds.filter((id) => id === "task:t1")).toHaveLength(1);
    expect(allClientIds).not.toContain("task:t1");
    expect(allClientIds).toContain("meeting:m1");
    // A prospect project's task is task-only.
    expect(feeds.clientEvents.map((e) => e.id)).not.toContain("task:t2");
  });

  it("returns empty feeds with no data", () => {
    expect(todayScheduleFeeds({ tasks: [], meetings: [], projects: [] })).toEqual({ taskEvents: [], clientEvents: [] });
  });
});
