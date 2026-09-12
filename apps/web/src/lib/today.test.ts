import { describe, expect, it } from "vitest";
import { activityHref, computeNextActions, computePipelineStages } from "./today";
import type { ActivityItem, Lead, PlanningListItem, Project } from "./api";

function lead(overrides: Partial<Lead> = {}): Pick<Lead, "id" | "status" | "archived_at"> {
  return { id: "l1", status: "new", archived_at: null, ...overrides };
}

function planningItem(overrides: Partial<PlanningListItem> = {}): Pick<PlanningListItem, "lead_id" | "status"> {
  return { lead_id: "l1", status: "ready_to_analyse", ...overrides };
}

function project(overrides: Partial<Project> = {}): Pick<Project, "stage"> {
  return { stage: "design", ...overrides } as Pick<Project, "stage">;
}

describe("computeNextActions", () => {
  it("returns nothing when there is genuinely nothing to do", () => {
    expect(computeNextActions({ leads: [], planning: [], projects: [] })).toEqual([]);
  });

  it("counts new/researched/qualified leads and links to the New tab", () => {
    const leads = [
      lead({ id: "a", status: "new" }),
      lead({ id: "b", status: "researched" }),
      lead({ id: "c", status: "won" }),
      lead({ id: "d", status: "new", archived_at: "2026-01-01T00:00:00Z" }), // archived — excluded
    ];
    const actions = computeNextActions({ leads, planning: [], projects: [] });
    const action = actions.find((a) => a.id === "new-leads")!;
    expect(action.count).toBe(2);
    expect(action.href).toBe("/dashboard/leads?tab=new");
  });

  it("counts qualified-or-further leads with no Planning workspace yet", () => {
    const leads = [
      lead({ id: "a", status: "contacted" }), // no planning -> ready
      lead({ id: "b", status: "proposal" }), // has planning -> not counted
      lead({ id: "c", status: "new" }), // too early -> not counted
      lead({ id: "d", status: "lost" }), // off to the side -> not counted
    ];
    const planning = [planningItem({ lead_id: "b" })];
    const actions = computeNextActions({ leads, planning, projects: [] });
    const action = actions.find((a) => a.id === "ready-for-planning")!;
    expect(action.count).toBe(1);
  });

  it("counts Planning items needing review", () => {
    const planning = [
      planningItem({ lead_id: "a", status: "needs_review" }),
      planningItem({ lead_id: "b", status: "completed" }),
      planningItem({ lead_id: "c", status: "needs_review" }),
    ];
    const actions = computeNextActions({ leads: [], planning, projects: [] });
    const action = actions.find((a) => a.id === "planning-needs-review")!;
    expect(action.count).toBe(2);
    expect(action.href).toBe("/dashboard/planning");
  });

  it("counts projects still at intake as ready to build", () => {
    const projects = [project({ stage: "intake" }), project({ stage: "design" }), project({ stage: "intake" })];
    const actions = computeNextActions({ leads: [], planning: [], projects });
    const action = actions.find((a) => a.id === "projects-ready-to-build")!;
    expect(action.count).toBe(2);
    expect(action.href).toBe("/dashboard/projects?stage=intake");
  });

  it("omits an action entirely when its count is zero, rather than showing a zero", () => {
    const actions = computeNextActions({ leads: [lead({ status: "lost" })], planning: [], projects: [] });
    expect(actions.map((a) => a.id)).toEqual([]);
  });
});

describe("computePipelineStages", () => {
  it("always returns all five stages in funnel order", () => {
    const stages = computePipelineStages({ reviewQueueCount: 0, leadsCount: 0, planningCount: 0, projects: [] });
    expect(stages.map((s) => s.id)).toEqual(["discovery", "leads", "planning", "projects", "live"]);
  });

  it("splits projects into in-build vs live using the same LIVE_STAGES as the Live Websites view", () => {
    const projects = [
      project({ stage: "design" }),
      project({ stage: "deployed" }),
      project({ stage: "maintenance" }),
      project({ stage: "complete" }),
    ];
    const stages = computePipelineStages({ reviewQueueCount: 0, leadsCount: 0, planningCount: 0, projects });
    expect(stages.find((s) => s.id === "projects")!.count).toBe(1);
    expect(stages.find((s) => s.id === "live")!.count).toBe(3);
  });

  it("gives an empty-state nudge only for stages that are actually empty", () => {
    const stages = computePipelineStages({ reviewQueueCount: 0, leadsCount: 0, planningCount: 3, projects: [] });
    expect(stages.find((s) => s.id === "leads")!.empty).toEqual({
      label: "Open Map Discovery",
      href: "/dashboard/discovery",
    });
    expect(stages.find((s) => s.id === "planning")!.empty).toBeUndefined();
    expect(stages.find((s) => s.id === "projects")!.empty).toEqual({
      label: "Open Planning",
      href: "/dashboard/planning",
    });
  });
});

describe("activityHref", () => {
  it("links a lead activity item to its lead detail page", () => {
    expect(activityHref({ entity_type: "lead", entity_id: "abc" } as ActivityItem)).toBe("/dashboard/leads/abc");
  });

  it("links a project activity item to its project detail page", () => {
    expect(activityHref({ entity_type: "project", entity_id: "abc" } as ActivityItem)).toBe(
      "/dashboard/projects/abc",
    );
  });

  it("falls back to Today for an unrecognised entity type", () => {
    expect(activityHref({ entity_type: "something_new", entity_id: "abc" } as ActivityItem)).toBe("/dashboard");
  });
});
