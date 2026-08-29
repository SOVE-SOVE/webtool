import { describe, expect, it } from "vitest";
import {
  checkpointProgress,
  deadlineStatus,
  nextOpenTask,
  projectStatusLabel,
  projectTone,
  stageProgress,
} from "./projects";
import type { Task } from "./api";

describe("stageProgress", () => {
  it("runs 0 → 100 across the stage sequence", () => {
    expect(stageProgress("intake")).toBe(0);
    expect(stageProgress("complete")).toBe(100);
    expect(stageProgress("development")).toBeGreaterThan(0);
    expect(stageProgress("development")).toBeLessThan(100);
  });
  it("increases monotonically", () => {
    expect(stageProgress("qa")).toBeGreaterThan(stageProgress("design"));
  });
});

describe("checkpointProgress", () => {
  it("is the approved fraction, rounded to a percent", () => {
    expect(checkpointProgress([])).toBe(0);
    expect(checkpointProgress([{ approved: true }, { approved: false }, { approved: false }, { approved: false }])).toBe(25);
    expect(checkpointProgress([{ approved: true }, { approved: true }])).toBe(100);
  });
});

describe("projectTone / projectStatusLabel", () => {
  it("groups stages into coarse tones", () => {
    expect(projectTone({ stage: "intake", delivered_at: null })).toBe("planning");
    expect(projectTone({ stage: "development", delivered_at: null })).toBe("building");
    expect(projectTone({ stage: "qa", delivered_at: null })).toBe("review");
    expect(projectTone({ stage: "deployed", delivered_at: null })).toBe("live");
    expect(projectTone({ stage: "development", delivered_at: "2026-08-01T00:00:00Z" })).toBe("done");
  });
  it("labels a delivered project 'Delivered' regardless of stage", () => {
    expect(projectStatusLabel({ stage: "development", delivered_at: "2026-08-01T00:00:00Z" })).toBe("Delivered");
    expect(projectStatusLabel({ stage: "development", delivered_at: null })).toBe("Development");
  });
});

function task(over: Partial<Task>): Task {
  return {
    id: "t", title: "x", done: false, due_at: null, project_id: "p1", lead_id: null,
    assigned_user_id: null, assigned_user_name: null, context: "", created_at: "2026-08-01T00:00:00Z",
    ...over,
  };
}

describe("nextOpenTask", () => {
  it("returns the soonest-due open task for the project", () => {
    const tasks = [
      task({ id: "done", done: true, due_at: "2026-08-01" }),
      task({ id: "later", due_at: "2026-09-10" }),
      task({ id: "sooner", due_at: "2026-09-01" }),
      task({ id: "otherproj", project_id: "p2", due_at: "2026-08-02" }),
    ];
    expect(nextOpenTask(tasks, "p1")?.id).toBe("sooner");
  });
  it("returns null when nothing is open", () => {
    expect(nextOpenTask([task({ done: true })], "p1")).toBeNull();
  });
});

describe("deadlineStatus", () => {
  const NOW = new Date("2026-08-24T00:00:00Z").getTime();
  it("classifies by distance", () => {
    expect(deadlineStatus(null, NOW)).toBe("none");
    expect(deadlineStatus("2026-08-20", NOW)).toBe("overdue");
    expect(deadlineStatus("2026-08-27", NOW)).toBe("soon");
    expect(deadlineStatus("2026-10-01", NOW)).toBe("ok");
  });
});
