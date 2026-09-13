import { describe, expect, it } from "vitest";
import {
  clientNextAction,
  clientTone,
  currentProject,
  mostRecentActivity,
  openTaskCount,
  projectsForClient,
} from "./clients";
import type { ActivityItem, Project, ProjectStage } from "./api";

function project(overrides: Partial<Project> & { id: string; client_id: string; stage: ProjectStage }): Project {
  return {
    business_id: "b1",
    client_business_name: "Acme",
    source_lead_id: null,
    name: "Website",
    package: null,
    price_cents: null,
    deadline: null,
    build_direction: null,
    assigned_user_id: null,
    assigned_user_name: null,
    delivered_at: null,
    delivered_by_user_name: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function activity(overrides: Partial<ActivityItem> & { id: string }): ActivityItem {
  return {
    user_id: null,
    user_name: null,
    entity_type: "client",
    entity_id: "c1",
    action: "created",
    summary: null,
    created_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

describe("projectsForClient", () => {
  it("filters to the given client", () => {
    const rows = [
      project({ id: "p1", client_id: "c1", stage: "design" }),
      project({ id: "p2", client_id: "c2", stage: "design" }),
    ];
    expect(projectsForClient(rows, "c1").map((p) => p.id)).toEqual(["p1"]);
  });
});

describe("clientTone", () => {
  it("is onboarding with no projects", () => {
    expect(clientTone([])).toBe("onboarding");
  });

  it("is active with any unfinished project", () => {
    expect(clientTone([project({ id: "p1", client_id: "c1", stage: "design" })])).toBe("active");
  });

  it("is complete only when every project is finished", () => {
    expect(clientTone([project({ id: "p1", client_id: "c1", stage: "maintenance" })])).toBe("complete");
    expect(
      clientTone([
        project({ id: "p1", client_id: "c1", stage: "complete" }),
        project({ id: "p2", client_id: "c1", stage: "design" }),
      ]),
    ).toBe("active");
  });
});

describe("currentProject", () => {
  it("returns null with no projects", () => {
    expect(currentProject([])).toBeNull();
  });

  it("prefers the unfinished project over a finished one", () => {
    const finished = project({ id: "p1", client_id: "c1", stage: "complete", updated_at: "2026-08-05T00:00:00Z" });
    const active = project({ id: "p2", client_id: "c1", stage: "design", updated_at: "2026-08-01T00:00:00Z" });
    expect(currentProject([finished, active])?.id).toBe("p2");
  });

  it("falls back to the most recently updated finished project", () => {
    const older = project({ id: "p1", client_id: "c1", stage: "complete", updated_at: "2026-08-01T00:00:00Z" });
    const newer = project({ id: "p2", client_id: "c1", stage: "maintenance", updated_at: "2026-08-05T00:00:00Z" });
    expect(currentProject([older, newer])?.id).toBe("p2");
  });
});

describe("clientNextAction", () => {
  it("asks to start intake with no project", () => {
    expect(clientNextAction(null, null)).toBe("Start intake");
  });

  it("surfaces the next open task title", () => {
    const p = project({ id: "p1", client_id: "c1", stage: "design" });
    expect(clientNextAction(p, "Send revised homepage")).toBe("Send revised homepage");
  });

  it("says there are no open tasks otherwise", () => {
    const p = project({ id: "p1", client_id: "c1", stage: "design" });
    expect(clientNextAction(p, null)).toBe("No open tasks");
  });
});

describe("mostRecentActivity", () => {
  it("matches the client's own activity and its projects', nothing else", () => {
    const rows = [
      activity({ id: "a1", entity_type: "client", entity_id: "c1", created_at: "2026-08-01T00:00:00Z" }),
      activity({ id: "a2", entity_type: "project", entity_id: "p1", created_at: "2026-08-05T00:00:00Z" }),
      activity({ id: "a3", entity_type: "lead", entity_id: "l1", created_at: "2026-08-09T00:00:00Z" }),
      activity({ id: "a4", entity_type: "client", entity_id: "other-client", created_at: "2026-08-10T00:00:00Z" }),
    ];
    const result = mostRecentActivity(rows, { id: "c1" }, [project({ id: "p1", client_id: "c1", stage: "design" })]);
    expect(result?.id).toBe("a2");
  });

  it("returns null when nothing matches", () => {
    expect(mostRecentActivity([], { id: "c1" }, [])).toBeNull();
  });
});

describe("openTaskCount", () => {
  it("counts only undone tasks on the given project", () => {
    const tasks = [
      { id: "t1", title: "A", done: false, due_at: null, project_id: "p1", lead_id: null, assigned_user_id: null, assigned_user_name: null, context: "", created_at: "" },
      { id: "t2", title: "B", done: true, due_at: null, project_id: "p1", lead_id: null, assigned_user_id: null, assigned_user_name: null, context: "", created_at: "" },
      { id: "t3", title: "C", done: false, due_at: null, project_id: "p2", lead_id: null, assigned_user_id: null, assigned_user_name: null, context: "", created_at: "" },
    ];
    expect(openTaskCount(tasks, "p1")).toBe(1);
  });

  it("is 0 with no project", () => {
    expect(openTaskCount([], null)).toBe(0);
  });
});
