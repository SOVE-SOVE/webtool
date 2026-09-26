import { describe, expect, it } from "vitest";
import type { Planning, StageChecklist } from "@/lib/api";
import { computeHandoffReadiness } from "./handoffReadiness";
import { PLANNING_CHECKLIST_TITLES } from "./processSteps";

function planning(overrides: Record<string, unknown> = {}): Planning {
  return {
    status: "completed",
    website_url: "https://x.test",
    website_audit_id: "a1",
    website_plan_generated_at: null,
    ...overrides,
  } as unknown as Planning;
}

function checklist(briefStatus: string | null): StageChecklist {
  return {
    items:
      briefStatus === null
        ? []
        : [{ title: PLANNING_CHECKLIST_TITLES.buildBriefApproved, status: briefStatus }],
  } as unknown as StageChecklist;
}

describe("computeHandoffReadiness", () => {
  it("an unapproved Build Brief is a blocker (the backend refuses without one)", () => {
    const r = computeHandoffReadiness(planning(), checklist("pending"));
    expect(r.canCreate).toBe(false);
    expect(r.blockers.map((b) => b.id)).toEqual(["brief"]);
  });

  it("approved brief + audit on file = can create", () => {
    expect(computeHandoffReadiness(planning(), checklist("complete"))).toMatchObject({
      canCreate: true,
      briefApproval: "approved",
      blockers: [],
    });
  });

  it("no audit and no plan blocks, whatever the brief says", () => {
    const r = computeHandoffReadiness(planning({ website_audit_id: null }), checklist("complete"));
    expect(r.blockers.map((b) => b.id)).toEqual(["research"]);
  });

  it("a running analysis blocks", () => {
    const r = computeHandoffReadiness(planning({ status: "analysing" }), checklist("complete"));
    expect(r.blockers.map((b) => b.id)).toEqual(["analysing"]);
  });

  it("a missing checklist item leaves approval unknown — not a made-up blocker", () => {
    const r = computeHandoffReadiness(planning(), checklist(null));
    expect(r).toMatchObject({ briefApproval: "unknown", canCreate: true });
    expect(computeHandoffReadiness(planning(), null).briefApproval).toBe("unknown");
  });

  it("the no-website path counts a generated plan as research on file", () => {
    const r = computeHandoffReadiness(
      planning({ website_url: null, website_audit_id: null, website_plan_generated_at: "2026-09-01T00:00:00Z" }),
      checklist("complete"),
    );
    expect(r.canCreate).toBe(true);
  });
});
