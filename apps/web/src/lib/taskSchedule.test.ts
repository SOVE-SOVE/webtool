import { describe, expect, it } from "vitest";
import {
  clientScheduleEvents,
  clientScope,
  compactMonthCells,
  indexScheduleByDay,
  resolveTaskClientId,
  scheduleDateKey,
  taskScheduleEvents,
} from "./taskSchedule";
import { toDateKey } from "./calendarGrid";

describe("scheduleDateKey", () => {
  it("passes a plain date through untouched", () => {
    expect(scheduleDateKey("2026-09-19")).toBe("2026-09-19");
  });

  it("places a datetime on its local day", () => {
    const local = new Date(2026, 8, 19, 23, 30);
    expect(scheduleDateKey(local.toISOString())).toBe(toDateKey(local));
  });

  it("returns null for an unparseable value", () => {
    expect(scheduleDateKey("not a date")).toBeNull();
  });
});

describe("compactMonthCells", () => {
  it("draws only the weeks the month touches", () => {
    // Feb 2026 starts on a Sunday and has 28 days: exactly 4 rows.
    expect(compactMonthCells(2026, 1)).toHaveLength(28);
    // Sept 2026 starts on a Tuesday, 30 days: 5 rows.
    expect(compactMonthCells(2026, 8)).toHaveLength(35);
    // Aug 2026 starts on a Saturday, 31 days: 6 rows.
    expect(compactMonthCells(2026, 7)).toHaveLength(42);
  });

  it("starts on a Sunday and includes every day of the month", () => {
    const cells = compactMonthCells(2026, 8);
    expect(cells[0].getDay()).toBe(0);
    const inMonth = cells.filter((d) => d.getMonth() === 8).map((d) => d.getDate());
    expect(inMonth).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });
});

describe("indexScheduleByDay", () => {
  it("buckets each source separately by day", () => {
    const byDay = indexScheduleByDay(
      [{ id: "task:1", title: "Send proofs", at: "2026-09-20" }],
      [{ id: "meeting:1", title: "Check-in", at: "2026-09-20" }],
    );
    expect(byDay.get("2026-09-20")?.task.map((e) => e.title)).toEqual(["Send proofs"]);
    expect(byDay.get("2026-09-20")?.client.map((e) => e.title)).toEqual(["Check-in"]);
  });

  it("keeps an item present in both sources once, under the task source", () => {
    const byDay = indexScheduleByDay(
      [{ id: "task:1", title: "Send proofs", at: "2026-09-20" }],
      [{ id: "task:1", title: "Send proofs", at: "2026-09-20" }],
    );
    expect(byDay.get("2026-09-20")).toEqual({
      task: [{ id: "task:1", title: "Send proofs", at: "2026-09-20" }],
      client: [],
    });
  });

  it("drops duplicate ids within one source and skips bad dates", () => {
    const byDay = indexScheduleByDay(
      [],
      [
        { id: "meeting:1", title: "A", at: "2026-09-01" },
        { id: "meeting:1", title: "A", at: "2026-09-01" },
        { id: "meeting:2", title: "B", at: "garbage" },
      ],
    );
    expect(byDay.size).toBe(1);
    expect(byDay.get("2026-09-01")?.client).toHaveLength(1);
  });

  it("returns an empty map for no events", () => {
    expect(indexScheduleByDay([], []).size).toBe(0);
  });
});

describe("resolveTaskClientId", () => {
  const projects = [
    { id: "p-client", client_id: "c1", source_lead_id: null },
    { id: "p-prospect", client_id: null, source_lead_id: "l-open" },
    { id: "p-converted", client_id: "c2", source_lead_id: "l-won" },
  ];

  it("follows a project task to its project's client", () => {
    expect(resolveTaskClientId({ project_id: "p-client", lead_id: null }, projects)).toBe("c1");
  });

  it("returns null for a prospect project or an unknown project", () => {
    expect(resolveTaskClientId({ project_id: "p-prospect", lead_id: null }, projects)).toBeNull();
    expect(resolveTaskClientId({ project_id: "missing", lead_id: null }, projects)).toBeNull();
  });

  it("finds the client of a converted lead, and none for an unconverted one", () => {
    expect(resolveTaskClientId({ project_id: null, lead_id: "l-won" }, projects)).toBe("c2");
    expect(resolveTaskClientId({ project_id: null, lead_id: "l-open" }, projects)).toBeNull();
  });
});

describe("clientScope", () => {
  it("collects a client's projects and originating leads", () => {
    const projects = [
      { id: "a", client_id: "c1", source_lead_id: "l1" },
      { id: "b", client_id: "c1", source_lead_id: null },
      { id: "c", client_id: "c2", source_lead_id: "l2" },
    ];
    expect(clientScope("c1", projects)).toEqual({ projectIds: ["a", "b"], leadIds: ["l1"] });
  });
});

describe("taskScheduleEvents", () => {
  it("emits the due date, and nothing for an undated task", () => {
    expect(taskScheduleEvents({ id: "1", title: "T", due_at: "2026-09-20T09:00:00Z" })).toEqual([
      { id: "task:1", title: "T", at: "2026-09-20T09:00:00Z" },
    ]);
    expect(taskScheduleEvents({ id: "1", title: "T", due_at: null })).toEqual([]);
  });
});

describe("clientScheduleEvents", () => {
  const scope = { projectIds: ["p1"], leadIds: ["l1"] };
  const task = (over: Partial<Parameters<typeof clientScheduleEvents>[0]["tasks"][number]>) => ({
    id: "t",
    title: "Task",
    done: false,
    due_at: "2026-09-21T00:00:00Z",
    project_id: "p1",
    lead_id: null,
    ...over,
  });

  it("includes meetings (minus cancelled, minus repeats) and in-scope open task due dates", () => {
    const events = clientScheduleEvents({
      scope,
      meetings: [
        { id: "m1", title: "Kickoff", status: "scheduled", scheduled_at: "2026-09-22T10:00:00Z" },
        { id: "m1", title: "Kickoff", status: "scheduled", scheduled_at: "2026-09-22T10:00:00Z" },
        { id: "m2", title: "Old", status: "cancelled", scheduled_at: "2026-09-23T10:00:00Z" },
      ],
      tasks: [
        task({ id: "t1", title: "Send proofs" }),
        task({ id: "t2", project_id: null, lead_id: "l1", title: "Pre-sale" }),
        task({ id: "t3", project_id: "other" }),
        task({ id: "t4", done: true }),
        task({ id: "t5", due_at: null }),
      ],
    });
    expect(events.map((e) => e.id)).toEqual(["meeting:m1", "task:t1", "task:t2"]);
    expect(events.find((e) => e.id === "task:t1")?.title).toBe("Due: Send proofs");
  });

  it("collapses with the task source so the current task isn't marked twice", () => {
    const current = { id: "t1", title: "Send proofs", due_at: "2026-09-21T09:00:00Z" };
    const byDay = indexScheduleByDay(
      taskScheduleEvents(current),
      clientScheduleEvents({ scope, meetings: [], tasks: [task({ ...current })] }),
    );
    const day = byDay.get(scheduleDateKey(current.due_at)!)!;
    expect(day.task).toHaveLength(1);
    expect(day.client).toHaveLength(0);
  });
});
