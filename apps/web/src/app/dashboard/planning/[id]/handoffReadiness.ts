import type { Planning, StageChecklist } from "@/lib/api";
import { PLANNING_CHECKLIST_TITLES, findChecklistItem } from "./processSteps";

/**
 * Confirm & create project — which unmet conditions actually stop
 * "Create project" (blockers) versus what's worth a look but doesn't
 * (warnings). Blockers are ONLY the existing prerequisite rules, never a
 * new gate:
 *   - page.tsx's `readyForHandoff`: a website audit or a generated
 *     website plan on file, with no analysis running;
 *   - the backend's own rule in `create_project_from_planning`: an
 *     approved Build Brief (NoApprovedBriefError otherwise). Read from the
 *     Planning checklist's AUTOMATIC "Approve the build brief" item —
 *     when that item is missing (renamed/removed) or the checklist hasn't
 *     loaded, approval is `unknown` and the backend stays the judge.
 * Everything else — open questions, other checklist items, feature
 * details — is a warning: the backend doesn't require it.
 */
export type ReadinessIssue = { id: string; text: string };

export type HandoffReadiness = {
  blockers: ReadinessIssue[];
  briefApproval: "approved" | "not_approved" | "unknown";
  canCreate: boolean;
};

export function computeHandoffReadiness(planning: Planning, checklist: StageChecklist | null): HandoffReadiness {
  const blockers: ReadinessIssue[] = [];
  if (planning.status === "analysing") {
    blockers.push({ id: "analysing", text: "Analysis is still running — wait for it to finish." });
  } else if (planning.website_audit_id === null && planning.website_plan_generated_at === null) {
    blockers.push({
      id: "research",
      text: planning.website_url
        ? "The website hasn't been analysed yet — run Analyse business first."
        : "No website plan yet — run Analyse business first.",
    });
  }

  const item = findChecklistItem(checklist, PLANNING_CHECKLIST_TITLES.buildBriefApproved);
  const briefApproval: HandoffReadiness["briefApproval"] = !item
    ? "unknown"
    : item.status === "complete"
      ? "approved"
      : "not_approved";
  if (briefApproval === "not_approved") {
    blockers.push({ id: "brief", text: "The Build Brief needs approving before a project can be created." });
  }

  return { blockers, briefApproval, canCreate: blockers.length === 0 };
}
