import { describe, expect, it } from "vitest";
import { planningCardBack, planningStepHref, type PlanningCardBackChecklist, type PlanningCardBackInput } from "./planningCardBack";
import { PLANNING_CHECKLIST_TITLES } from "../../planning/[id]/processSteps";

function item(overrides: Partial<PlanningCardBackInput> = {}): PlanningCardBackInput {
  return {
    id: "p1",
    project_id: null,
    status: "completed",
    website_url: "https://example.com",
    website_audit_id: "a1",
    website_plan_generated_at: null,
    content_draft_status: null,
    ...overrides,
  };
}

function checklist(next: string | null, completed = 2, total = 6): PlanningCardBackChecklist {
  return { next_item_title: next, completed, total };
}

describe("planningStepHref", () => {
  it("always names the step explicitly, so the remembered step never overrides it", () => {
    expect(planningStepHref("p1", "research")).toBe("/dashboard/planning/p1?step=research");
    expect(planningStepHref("p1", "review")).toBe("/dashboard/planning/p1?step=review");
  });
});

describe("planningCardBack", () => {
  it("not analysed, with a website: Analyse business, analyse the website", () => {
    const back = planningCardBack(item({ status: "ready_to_analyse", website_audit_id: null }), checklist(null, 0, 6));
    expect(back).toMatchObject({
      step: "research",
      stepLabel: "Analyse business",
      message: "Analyse the website to start this plan.",
      attention: false,
      href: "/dashboard/planning/p1?step=research",
      cta: "Continue planning →",
    });
  });

  it("not analysed, no website: says a plan needs generating", () => {
    const back = planningCardBack(item({ status: "ready_to_analyse", website_audit_id: null, website_url: null }), undefined);
    expect(back.step).toBe("research");
    expect(back.message).toMatch(/No website on record/);
  });

  it("analysis running: Analyse business, wait for it — wins over any checklist", () => {
    const back = planningCardBack(item({ status: "analysing" }), checklist(PLANNING_CHECKLIST_TITLES.buildBriefApproved));
    expect(back).toMatchObject({ step: "research", attention: false, href: "/dashboard/planning/p1?step=research" });
    expect(back.message).toMatch(/running/);
  });

  it("analysis complete, nothing chosen yet: the checklist's next item places it (audit review)", () => {
    const back = planningCardBack(item(), checklist(PLANNING_CHECKLIST_TITLES.audit, 0, 6));
    expect(back).toMatchObject({ step: "research", message: "Review the website audit findings." });
  });

  it("new-website mode words the research review as the generated plan", () => {
    const back = planningCardBack(
      item({ website_audit_id: null, website_plan_generated_at: "2026-09-01T00:00:00Z" }),
      checklist(PLANNING_CHECKLIST_TITLES.audit, 0, 6),
    );
    expect(back.message).toBe("Review the generated website plan.");
  });

  it("research reviewed, recommendations next: Choose your website", () => {
    const back = planningCardBack(item(), checklist(PLANNING_CHECKLIST_TITLES.recommendations));
    expect(back).toMatchObject({
      step: "plan",
      stepLabel: "Choose your website",
      message: "Review the improvement recommendations.",
      href: "/dashboard/planning/p1?step=plan",
    });
  });

  it("website chosen but not confirmed: Confirm & create project, approve the brief", () => {
    const back = planningCardBack(item(), checklist(PLANNING_CHECKLIST_TITLES.buildBriefApproved, 5, 6));
    expect(back).toMatchObject({
      step: "review",
      stepLabel: "Confirm & create project",
      message: "Approve the build brief, then create the project.",
      href: "/dashboard/planning/p1?step=review",
    });
  });

  it("ready to create the project: every required task done, no project yet", () => {
    const back = planningCardBack(item(), checklist(null, 6, 6));
    expect(back).toMatchObject({ step: "review", message: "All planning tasks are done. Create the project.", attention: false });
  });

  it("failed analysis with nothing to show: explains, routes to the Research retry, starts nothing", () => {
    const back = planningCardBack(item({ status: "failed", website_audit_id: null }), checklist(PLANNING_CHECKLIST_TITLES.audit));
    expect(back).toMatchObject({
      step: "research",
      attention: true,
      message: "The analysis didn't finish. Retry it from Analyse business.",
      href: "/dashboard/planning/p1?step=research",
      cta: "Continue planning →",
    });
  });

  it("failed re-analysis keeps saying earlier results are still there", () => {
    const back = planningCardBack(item({ status: "failed" }), checklist(PLANNING_CHECKLIST_TITLES.recommendations));
    expect(back).toMatchObject({ step: "research", attention: true });
    expect(back.message).toMatch(/Earlier results are kept/);
  });

  it("a degraded (needs review) run is flagged while Research is still the open step", () => {
    const back = planningCardBack(item({ status: "needs_review" }), checklist(PLANNING_CHECKLIST_TITLES.audit, 0, 6));
    expect(back).toMatchObject({ step: "research", attention: true, href: "/dashboard/planning/p1?step=research" });
    expect(planningCardBack(item({ status: "needs_review" }), undefined)).toMatchObject({ step: "research", attention: true });
  });

  it("once its review is checked off and the plan moved on, needs review no longer holds it at Research", () => {
    const back = planningCardBack(item({ status: "needs_review" }), checklist(PLANNING_CHECKLIST_TITLES.recommendations));
    expect(back).toMatchObject({ step: "plan", attention: false, message: "Review the improvement recommendations." });
  });

  it("a failed content draft routes to Choose your website, where its Retry is", () => {
    const back = planningCardBack(item({ content_draft_status: "failed" }), checklist(PLANNING_CHECKLIST_TITLES.buildBriefApproved));
    expect(back).toMatchObject({ step: "plan", attention: true, href: "/dashboard/planning/p1?step=plan" });
  });

  it("handed off: the existing project link, not a planning step", () => {
    const back = planningCardBack(item({ project_id: "proj-9" }), checklist(null, 6, 6));
    expect(back).toMatchObject({
      step: "review",
      href: "/dashboard/projects/proj-9",
      cta: "Open project →",
      attention: false,
    });
  });

  it("handed off wins even over a failed or running state", () => {
    expect(planningCardBack(item({ project_id: "proj-9", status: "failed" }), undefined).href).toBe("/dashboard/projects/proj-9");
  });

  it("no checklist summary (not loaded or failed): no step is claimed", () => {
    const back = planningCardBack(item(), undefined);
    expect(back).toMatchObject({ step: null, stepLabel: null, message: "Open to see what's next.", attention: false });
    expect(back.href).toBe("/dashboard/planning/p1?step=research");
  });

  it("a renamed/custom next task: no step is claimed", () => {
    expect(planningCardBack(item(), checklist("Call the client")).step).toBeNull();
  });

  it("only blocked tasks left: no step claimed, sent to the checklist in Confirm & create project", () => {
    const back = planningCardBack(item(), checklist(null, 4, 6));
    expect(back).toMatchObject({ step: null, href: "/dashboard/planning/p1?step=review" });
    expect(back.message).toMatch(/blocked/);
  });
});
