import { describe, expect, it } from "vitest";
import {
  CONTINUE_PROJECT,
  OPEN_PROJECT,
  UNKNOWN_NEXT,
  projectCardBack,
  type ProjectCardBackChecklist,
  type ProjectCardBackDeployment,
  type ProjectCardBackInput,
} from "./projectCardBack";
import type { ProjectStage } from "../../../../lib/api";

function project(overrides: Partial<ProjectCardBackInput> = {}): ProjectCardBackInput {
  return {
    id: "p1",
    name: "Coastal Cafe Website",
    client_business_name: "Coastal Cafe",
    stage: "intake",
    delivered_at: null,
    ...overrides,
  };
}

function checklist(overrides: Partial<ProjectCardBackChecklist> = {}): ProjectCardBackChecklist {
  return { next_item_title: "Review build inputs", blocked_reason: null, ...overrides };
}

function deployment(status: ProjectCardBackDeployment["status"], created_at = "2026-05-01T00:00:00Z"): ProjectCardBackDeployment {
  return { status, created_at };
}

const BASE = "/dashboard/projects/p1";
const tab = (t: string) => `${BASE}/website?tab=${t}`;

describe("projectCardBack — each stage's gate, in the project's own vocabulary", () => {
  const cases: [ProjectStage, string, string, string][] = [
    ["intake", "Intake", "Confirm the client intake.", BASE],
    ["brief", "Scoping", "Approve the creative direction and sitemap.", BASE],
    ["design", "Design", "Generate the website build.", tab("content")],
    ["development", "Development", "Review and approve the generated website.", tab("approval")],
    ["qa", "QA", "Run QA and sign it off.", tab("qa")],
    ["client_review", "Client review", "Record the client's approval.", tab("approval")],
    ["revisions", "Revisions", "Work through the client's change requests.", tab("approval")],
    ["ready_to_deploy", "Ready to deploy", "Deploy the approved website.", tab("deployment")],
    ["deployed", "Deployed", "Finish the delivery checklist, then mark it delivered.", tab("deployment")],
  ];
  it.each(cases)("%s → %s", (stage, label, message, href) => {
    const back = projectCardBack(project({ stage }), checklist(), stage === "ready_to_deploy" || stage === "deployed" ? [] : null);
    expect(back).toEqual({ name: "Coastal Cafe Website", stageLabel: label, message, attention: false, href, cta: CONTINUE_PROJECT });
  });

  it("never uses Planning's step labels", () => {
    for (const [stage] of cases) {
      const back = projectCardBack(project({ stage }), undefined, null);
      expect(back.stageLabel).not.toMatch(/Analyse business|Choose your website|Confirm & create project/);
    }
  });

  it("research has no gate of its own — the checklist's next item places it", () => {
    expect(projectCardBack(project({ stage: "research" }), checklist(), null)).toMatchObject({
      stageLabel: "Research",
      message: "Review the build inputs.",
      href: BASE,
    });
    expect(
      projectCardBack(project({ stage: "research" }), checklist({ next_item_title: "Review desktop and mobile" }), null),
    ).toMatchObject({ message: "Review the preview on desktop and mobile.", href: tab("preview") });
    expect(projectCardBack(project({ stage: "research" }), checklist({ next_item_title: "Complete QA" }), null)).toMatchObject({
      href: tab("qa"),
    });
  });
});

describe("projectCardBack — finished projects", () => {
  it("delivered: the existing 'nothing outstanding' line and Open project, whatever the stage says", () => {
    for (const stage of ["deployed", "complete", "maintenance"] as ProjectStage[]) {
      expect(projectCardBack(project({ stage, delivered_at: "2026-05-02T00:00:00Z" }), checklist(), [deployment("success")])).toEqual({
        name: "Coastal Cafe Website",
        stageLabel: "Delivered",
        message: "Delivered — nothing outstanding.",
        attention: false,
        href: BASE,
        cta: OPEN_PROJECT,
      });
    }
  });

  it("complete without a recorded delivery", () => {
    expect(projectCardBack(project({ stage: "complete" }), checklist(), [])).toMatchObject({
      stageLabel: "Complete",
      message: "Marked complete — nothing outstanding.",
      href: BASE,
      cta: OPEN_PROJECT,
    });
  });

  it("maintenance", () => {
    expect(projectCardBack(project({ stage: "maintenance" }), checklist(), [])).toMatchObject({
      stageLabel: "Maintenance",
      cta: OPEN_PROJECT,
      href: BASE,
      attention: false,
    });
  });
});

describe("projectCardBack — failures replace the next action", () => {
  it("the latest deployment failed → Deployment tab", () => {
    expect(projectCardBack(project({ stage: "ready_to_deploy" }), checklist(), [deployment("failed")])).toEqual({
      name: "Coastal Cafe Website",
      stageLabel: "Ready to deploy",
      message: "The last deployment failed. Review it in Deployment.",
      attention: true,
      href: tab("deployment"),
      cta: CONTINUE_PROJECT,
    });
  });

  it("a failure is flagged even on a delivered project, since the latest attempt broke", () => {
    const back = projectCardBack(project({ stage: "complete", delivered_at: "2026-05-02T00:00:00Z" }), checklist(), [
      deployment("success", "2026-05-01T00:00:00Z"),
      deployment("failed", "2026-05-03T00:00:00Z"),
    ]);
    expect(back).toMatchObject({ attention: true, stageLabel: "Delivered", href: tab("deployment") });
  });

  it("an older failure a later deployment superseded isn't flagged (order-independent)", () => {
    const back = projectCardBack(project({ stage: "deployed" }), checklist(), [
      deployment("success", "2026-05-03T00:00:00Z"),
      deployment("failed", "2026-05-01T00:00:00Z"),
    ]);
    expect(back.attention).toBe(false);
    expect(back.message).toBe("Finish the delivery checklist, then mark it delivered.");
  });

  it("a blocked checklist task shows its own reason and links to the project's checklist", () => {
    expect(projectCardBack(project({ stage: "design" }), checklist({ blocked_reason: "Waiting on the client's logo" }), null)).toMatchObject({
      message: "Blocked: Waiting on the client's logo",
      attention: true,
      href: BASE,
      cta: CONTINUE_PROJECT,
    });
  });

  it("a deployment failure outranks a blocked task (same priority as the front's attention line)", () => {
    const back = projectCardBack(project({ stage: "ready_to_deploy" }), checklist({ blocked_reason: "x" }), [deployment("failed")]);
    expect(back.message).toMatch(/deployment failed/);
  });

  it("a deployment in progress is said plainly, not as a failure", () => {
    for (const status of ["pending", "running"] as const) {
      expect(projectCardBack(project({ stage: "ready_to_deploy" }), checklist(), [deployment(status)])).toMatchObject({
        message: "A deployment is in progress. Check back when it finishes.",
        attention: false,
        href: tab("deployment"),
      });
    }
  });
});

describe("projectCardBack — missing data", () => {
  it("no checklist summary and no deployments: still the stage gate, never a failure claim", () => {
    expect(projectCardBack(project({ stage: "qa" }), undefined, null)).toMatchObject({ message: "Run QA and sign it off.", attention: false });
  });

  it("research with no checklist, or an unrecognised item → conservative fallback to the project page", () => {
    for (const c of [undefined, checklist({ next_item_title: null }), checklist({ next_item_title: "Custom task" })]) {
      expect(projectCardBack(project({ stage: "research" }), c, null)).toMatchObject({ message: UNKNOWN_NEXT, href: BASE, attention: false });
    }
  });

  it("an unknown stage has no label and falls back", () => {
    const back = projectCardBack(project({ stage: "archived" as ProjectStage }), undefined, null);
    expect(back).toMatchObject({ stageLabel: null, message: UNKNOWN_NEXT, href: BASE });
  });

  it("a whitespace-only blocked reason isn't treated as a block", () => {
    expect(projectCardBack(project(), checklist({ blocked_reason: "  " }), null).attention).toBe(false);
  });
});

describe("projectCardBack — names", () => {
  it("passes a long name through untouched (the card clamps it visually)", () => {
    const long = "Riverside Family Plumbing, Gas Fitting & Emergency Hot Water Services — Full Website Rebuild 2026";
    expect(projectCardBack(project({ name: long }), undefined, null).name).toBe(long);
  });

  it("falls back to the business name when the project name is blank", () => {
    expect(projectCardBack(project({ name: "   " }), undefined, null).name).toBe("Coastal Cafe");
  });
});
