import { describe, expect, it } from "vitest";
import {
  activityHref,
  attentionPriority,
  attentionTag,
  computeNextActions,
  computePipelineStages,
  todaysScheduleEvents,
} from "./today";
import type { ActivityItem, AttentionItem, CalendarEvent, Lead, PlanningListItem, Project } from "./api";

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

function attentionItem(overrides: Partial<Pick<AttentionItem, "kind" | "detail">> = {}) {
  return { kind: "task" as AttentionItem["kind"], detail: "no due date", ...overrides };
}

describe("attentionPriority", () => {
  it("ranks a stale lead as low regardless of its detail text", () => {
    expect(attentionPriority(attentionItem({ kind: "stale_lead", detail: "No movement in 9 days" }))).toBe("low");
  });

  it("ranks an imminent meeting and a blocked project as high", () => {
    expect(attentionPriority(attentionItem({ kind: "meeting" }))).toBe("high");
    expect(attentionPriority(attentionItem({ kind: "project" }))).toBe("high");
  });

  it("ranks anything overdue as high, regardless of kind", () => {
    expect(attentionPriority(attentionItem({ kind: "follow_up", detail: "2 days overdue" }))).toBe("high");
    expect(attentionPriority(attentionItem({ kind: "task", detail: "Lead: Acme — overdue" }))).toBe("high");
  });

  it("falls back to medium for a follow-up or task due but not overdue", () => {
    expect(attentionPriority(attentionItem({ kind: "follow_up", detail: "Due today" }))).toBe("medium");
    expect(attentionPriority(attentionItem({ kind: "task", detail: "Project: Acme site — due 2026-09-20" }))).toBe(
      "medium",
    );
  });
});

describe("attentionTag", () => {
  it("labels anything overdue as Overdue before checking kind", () => {
    expect(attentionTag(attentionItem({ kind: "task", detail: "Lead: Acme — overdue" }))).toBe("Overdue");
  });

  it("gives each kind its own tag when not overdue", () => {
    expect(attentionTag(attentionItem({ kind: "follow_up", detail: "Due today" }))).toBe("Due today");
    expect(attentionTag(attentionItem({ kind: "meeting", detail: "Call — Mon, 10:00" }))).toBe("Meeting soon");
    expect(attentionTag(attentionItem({ kind: "project", detail: "Waiting on QA sign-off" }))).toBe("Action needed");
    expect(attentionTag(attentionItem({ kind: "stale_lead", detail: "No movement in 9 days" }))).toBe("Gone quiet");
  });
});

describe("todaysScheduleEvents", () => {
  function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
    return {
      kind: "meeting",
      id: "e1",
      title: "Call",
      at: "2026-09-13T10:00:00Z",
      detail: "",
      done: false,
      href: "/dashboard/calendar",
      ...overrides,
    };
  }

  it("sorts by time, earliest first", () => {
    const events = [
      event({ id: "late", at: "2026-09-13T15:00:00Z" }),
      event({ id: "early", at: "2026-09-13T09:00:00Z" }),
    ];
    expect(todaysScheduleEvents(events).map((e) => e.id)).toEqual(["early", "late"]);
  });

  it("drops events already marked done", () => {
    const events = [event({ id: "done", done: true }), event({ id: "pending", done: false })];
    expect(todaysScheduleEvents(events).map((e) => e.id)).toEqual(["pending"]);
  });
});
