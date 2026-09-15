// Relative imports for the runtime value import (deadlineStatus) so
// this stays runnable under vitest, which has no "@/" path-alias
// config — same convention as lib/projects.ts itself. Type-only
// imports are erased at compile time and don't need this.
import type { Project, ProjectChecklistSummary, ProjectStage } from "@/lib/api";
import { deadlineStatus } from "../../../../lib/projects";

export type ProjectOwnerType = "prospect" | "client";

/** Same client_id !== null check the rest of the app already uses to
 * tell a Lead-owned prospect project from a Client-owned one. */
export function projectOwnerType(project: Pick<Project, "client_id">): ProjectOwnerType {
  return project.client_id !== null ? "client" : "prospect";
}

export const PROJECT_OWNER_LABEL: Record<ProjectOwnerType, string> = {
  prospect: "Prospect",
  client: "Client",
};

const BUILD_STAGES: ProjectStage[] = ["design", "development"];
const PREVIEW_STAGES: ProjectStage[] = ["qa", "client_review", "revisions", "ready_to_deploy"];

export type ProjectCardActionKind = "progress" | "preview" | "visit" | "open";

export type ProjectCardAction = {
  kind: ProjectCardActionKind;
  label: string;
  href: string;
  /** true only for "Visit Website" — an external link to the real deployment, not an internal route. */
  external?: boolean;
};

/**
 * The Projects grid's one primary action per card — reuses exactly the
 * real signals already driving the rest of the app: `project.stage`
 * (the same fixed pipeline `ProjectStatusBadge`/`stageProgress` already
 * read) for View Build Progress/Open Preview, and a real non-mock live
 * deployment (see WebsiteCard's own `liveNonMockDeployment` — the same
 * guard, not a second copy of the "mock is never clickable" rule) for
 * Visit Website. Every kind except "visit" links into the same Project
 * workspace this app already has — this only decides the label/
 * destination, never triggers a build or deployment itself.
 */
export function projectCardAction(project: Pick<Project, "id" | "stage">, liveUrl: string | null): ProjectCardAction {
  const base = `/dashboard/projects/${project.id}`;
  if (liveUrl) {
    return { kind: "visit", label: "Visit Website", href: liveUrl, external: true };
  }
  if (BUILD_STAGES.includes(project.stage)) {
    return { kind: "progress", label: "View Build Progress", href: base };
  }
  if (PREVIEW_STAGES.includes(project.stage)) {
    return { kind: "preview", label: "Open Preview", href: `${base}/website` };
  }
  return { kind: "open", label: "Open Project", href: base };
}

/**
 * A concise, single reason a card needs attention — or null, never a
 * fabricated "all good" line. Priority: a real failed deployment attempt
 * (Deployment.status === "failed", passed in by the caller since it's
 * only fetched for stages where a deployment could exist at all) beats
 * a blocked checklist task, which beats the two review-in-progress
 * stages (client_review/revisions — both already real, distinct
 * ProjectStage values, not inferred), which beats an overdue deadline.
 * Only one line is ever shown — never stacked with the status badge's
 * own text.
 */
export function projectAttentionReason(
  project: Pick<Project, "stage" | "deadline">,
  checklist: Pick<ProjectChecklistSummary, "blocked_reason"> | undefined,
  hasFailedDeployment: boolean,
): string | null {
  if (hasFailedDeployment) return "Deployment failed";
  if (checklist?.blocked_reason) return `Blocked: ${checklist.blocked_reason}`;
  if (project.stage === "client_review") return "Awaiting client review";
  if (project.stage === "revisions") return "Revisions requested";
  if (deadlineStatus(project.deadline) === "overdue") return "Deadline overdue";
  return null;
}
