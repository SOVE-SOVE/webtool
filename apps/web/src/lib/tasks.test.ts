import { describe, expect, it } from "vitest";
import {
  groupOpenTasksByUrgency,
  listTaskFilterOptions,
  taskContextHref,
  taskContextKind,
  taskContextName,
  taskFilterKey,
  taskMatchesFilter,
  taskMatchesSearch,
  taskMatchesTab,
  taskUrgency,
} from "./tasks";
import type { Task } from "./api";

// Built from local y/m/d components (not a fixed "...Z" string) so the
// "start of today" boundary in taskUrgency — which uses the local clock,
// since that's what an operator's due date means to them — lines up
// regardless of which timezone the test runner is in.
const NOW = new Date(2026, 8, 13, 12, 0, 0).getTime();

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "Build homepage",
    done: false,
    due_at: null,
    project_id: "p1",
    lead_id: null,
    assigned_user_id: null,
    assigned_user_name: null,
    context: "Project: Vibe Nails",
    created_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

describe("taskUrgency", () => {
  it("is none for an undated task", () => {
    expect(taskUrgency(task({ due_at: null }), NOW)).toBe("none");
  });
  it("is overdue for a due date before today", () => {
    expect(taskUrgency(task({ due_at: new Date(2026, 8, 10).toISOString() }), NOW)).toBe("overdue");
  });
  it("is today for a due date within today", () => {
    expect(taskUrgency(task({ due_at: new Date(2026, 8, 13, 23, 0, 0).toISOString() }), NOW)).toBe("today");
  });
  it("is upcoming for a due date after today", () => {
    expect(taskUrgency(task({ due_at: new Date(2026, 8, 20).toISOString() }), NOW)).toBe("upcoming");
  });
});

describe("groupOpenTasksByUrgency", () => {
  it("excludes done tasks entirely", () => {
    const groups = groupOpenTasksByUrgency(
      [task({ id: "a", done: true, due_at: new Date(2026, 8, 10).toISOString() })],
      NOW,
    );
    expect(groups.overdue).toHaveLength(0);
  });

  it("buckets each open task by urgency and sorts soonest-first within a bucket", () => {
    const groups = groupOpenTasksByUrgency(
      [
        task({ id: "a", due_at: new Date(2026, 8, 25).toISOString() }),
        task({ id: "b", due_at: new Date(2026, 8, 5).toISOString() }), // overdue
        task({ id: "c", due_at: new Date(2026, 8, 13, 18, 0, 0).toISOString() }), // today
        task({ id: "d", due_at: new Date(2026, 8, 20).toISOString() }),
        task({ id: "e", due_at: null }),
        task({ id: "f", due_at: new Date(2026, 8, 1).toISOString() }), // overdue, earlier than b
      ],
      NOW,
    );
    expect(groups.overdue.map((t) => t.id)).toEqual(["f", "b"]);
    expect(groups.today.map((t) => t.id)).toEqual(["c"]);
    expect(groups.upcoming.map((t) => t.id)).toEqual(["d", "a"]);
    expect(groups.noDueDate.map((t) => t.id)).toEqual(["e"]);
  });
});

describe("taskMatchesTab", () => {
  it("open matches only not-done tasks", () => {
    expect(taskMatchesTab(task({ done: false }), "open")).toBe(true);
    expect(taskMatchesTab(task({ done: true }), "open")).toBe(false);
  });
  it("done matches only done tasks", () => {
    expect(taskMatchesTab(task({ done: true }), "done")).toBe(true);
    expect(taskMatchesTab(task({ done: false }), "done")).toBe(false);
  });
  it("all matches everything", () => {
    expect(taskMatchesTab(task({ done: true }), "all")).toBe(true);
    expect(taskMatchesTab(task({ done: false }), "all")).toBe(true);
  });
});

describe("taskContextName / taskContextKind / taskContextHref", () => {
  it("strips the Project: prefix and links to the project", () => {
    const t = task({ project_id: "p1", lead_id: null, context: "Project: Vibe Nails" });
    expect(taskContextName(t)).toBe("Vibe Nails");
    expect(taskContextKind(t)).toBe("project");
    expect(taskContextHref(t)).toBe("/dashboard/projects/p1");
  });
  it("strips the Lead: prefix and links to the lead", () => {
    const t = task({ project_id: null, lead_id: "l1", context: "Lead: Costa D'Ora" });
    expect(taskContextName(t)).toBe("Costa D'Ora");
    expect(taskContextKind(t)).toBe("lead");
    expect(taskContextHref(t)).toBe("/dashboard/leads/l1");
  });
});

describe("taskFilterKey / taskMatchesFilter / listTaskFilterOptions", () => {
  it("keys a task by its project or lead", () => {
    expect(taskFilterKey(task({ project_id: "p1", lead_id: null }))).toBe("project:p1");
    expect(taskFilterKey(task({ project_id: null, lead_id: "l1" }))).toBe("lead:l1");
  });
  it("empty filter matches everything, a real key matches only that project/lead", () => {
    const t = task({ project_id: "p1", lead_id: null });
    expect(taskMatchesFilter(t, "")).toBe(true);
    expect(taskMatchesFilter(t, "project:p1")).toBe(true);
    expect(taskMatchesFilter(t, "project:p2")).toBe(false);
  });
  it("lists one option per distinct project/lead, alphabetically", () => {
    const options = listTaskFilterOptions([
      task({ project_id: "p2", lead_id: null, context: "Project: Zeta" }),
      task({ project_id: "p1", lead_id: null, context: "Project: Alpha" }),
      task({ project_id: "p1", lead_id: null, context: "Project: Alpha" }),
    ]);
    expect(options).toEqual([
      { key: "project:p1", label: "Alpha" },
      { key: "project:p2", label: "Zeta" },
    ]);
  });
});

describe("taskMatchesSearch", () => {
  it("matches on title or context, case-insensitively", () => {
    const t = task({ title: "Build homepage", context: "Project: Vibe Nails" });
    expect(taskMatchesSearch(t, "homepage")).toBe(true);
    expect(taskMatchesSearch(t, "VIBE")).toBe(true);
    expect(taskMatchesSearch(t, "something else")).toBe(false);
    expect(taskMatchesSearch(t, "")).toBe(true);
  });
});
