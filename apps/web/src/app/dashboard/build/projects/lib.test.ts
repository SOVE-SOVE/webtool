import { describe, expect, it } from "vitest";
import { projectAttentionReason, projectCardAction, projectOwnerType, type ProjectCardActionKind } from "./lib";
import type { Project, ProjectChecklistSummary, ProjectStage } from "../../../../lib/api";

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    client_id: "c1",
    business_id: "b1",
    client_business_name: "Coastal Cafe",
    source_lead_id: null,
    name: "Coastal Cafe Website",
    stage: "design",
    package: null,
    price_cents: null,
    deadline: null,
    build_direction: null,
    assigned_user_id: null,
    assigned_user_name: null,
    delivered_at: null,
    delivered_by_user_name: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function summary(overrides: Partial<ProjectChecklistSummary> = {}): ProjectChecklistSummary {
  return {
    project_id: "p1",
    completed: 0,
    total: 6,
    pct: 0,
    next_item_title: "Review build inputs",
    blocked_reason: null,
    ...overrides,
  };
}

describe("projectOwnerType", () => {
  it("is 'client' whenever client_id is set", () => {
    expect(projectOwnerType(project({ client_id: "c1" }))).toBe("client");
  });

  it("is 'prospect' with no client_id (Lead-owned)", () => {
    expect(projectOwnerType(project({ client_id: null }))).toBe("prospect");
  });
});

describe("projectCardAction — the Projects grid's one primary action per state", () => {
  const stages: [ProjectStage, ProjectCardActionKind][] = [
    ["intake", "open"],
    ["research", "open"],
    ["brief", "open"],
    ["design", "progress"],
    ["development", "progress"],
    ["qa", "preview"],
    ["client_review", "preview"],
    ["revisions", "preview"],
    ["ready_to_deploy", "preview"],
    ["deployed", "open"],
    ["maintenance", "open"],
    ["complete", "open"],
  ];

  it.each(stages)("stage %s with no live deployment resolves to kind %s", (stage, kind) => {
    expect(projectCardAction(project({ stage }), null).kind).toBe(kind);
  });

  it("shows View Build Progress during design/development, linking to the project itself", () => {
    const action = projectCardAction(project({ id: "p1", stage: "design" }), null);
    expect(action).toEqual({ kind: "progress", label: "View Build Progress", href: "/dashboard/projects/p1" });
  });

  it("shows Open Preview once a draft exists to review, linking to the website workspace", () => {
    const action = projectCardAction(project({ id: "p1", stage: "qa" }), null);
    expect(action).toEqual({ kind: "preview", label: "Open Preview", href: "/dashboard/projects/p1/website" });
  });

  it("shows Visit Website whenever a real live deployment URL is supplied, regardless of stage", () => {
    const action = projectCardAction(project({ stage: "deployed" }), "https://coastalcafe.example");
    expect(action).toEqual({
      kind: "visit",
      label: "Visit Website",
      href: "https://coastalcafe.example",
      external: true,
    });
  });

  it("falls back to Open Project once live but with no real (non-mock) deployment", () => {
    const action = projectCardAction(project({ id: "p1", stage: "deployed" }), null);
    expect(action).toEqual({ kind: "open", label: "Open Project", href: "/dashboard/projects/p1" });
  });
});

describe("projectAttentionReason — one concise line, never a fabricated all-clear", () => {
  it("is null when nothing is wrong", () => {
    expect(projectAttentionReason(project({ stage: "design" }), summary({ blocked_reason: null }), false)).toBeNull();
  });

  it("reports a failed deployment first, above every other signal", () => {
    const reason = projectAttentionReason(
      project({ stage: "client_review", deadline: "2020-01-01T00:00:00Z" }),
      summary({ blocked_reason: "Waiting on photos" }),
      true,
    );
    expect(reason).toBe("Deployment failed");
  });

  it("reports a blocked checklist task with its real reason", () => {
    const reason = projectAttentionReason(project({ stage: "design" }), summary({ blocked_reason: "Waiting on photos" }), false);
    expect(reason).toBe("Blocked: Waiting on photos");
  });

  it("reports the client_review stage as awaiting review", () => {
    expect(projectAttentionReason(project({ stage: "client_review" }), summary({ blocked_reason: null }), false)).toBe(
      "Awaiting client review",
    );
  });

  it("reports the revisions stage as revisions requested", () => {
    expect(projectAttentionReason(project({ stage: "revisions" }), summary({ blocked_reason: null }), false)).toBe(
      "Revisions requested",
    );
  });

  it("reports an overdue deadline last, only once nothing else applies", () => {
    const overdue = new Date(Date.now() - 86_400_000).toISOString();
    expect(projectAttentionReason(project({ stage: "design", deadline: overdue }), undefined, false)).toBe(
      "Deadline overdue",
    );
  });

  it("never fabricates a reason when the checklist summary hasn't loaded yet", () => {
    expect(projectAttentionReason(project({ stage: "design" }), undefined, false)).toBeNull();
  });
});
