import type { Deployment, Project, ProjectChecklistSummary, ProjectStage } from "@/lib/api";
// Relative (not "@/") so vitest, which has no path alias, can load it.
import { projectStatusLabel } from "../../../../lib/projects";

/**
 * What the back of a Projects list card says: the project's current
 * stage (its own ProjectStage vocabulary, via the same
 * projectStatusLabel the front's badge reads), one next action, and
 * where "Continue project" goes. Pure, and derived ONLY from what the
 * list page already holds — the list row, the bulk checklist summary,
 * and the deployments the front already fetches for ready-to-deploy and
 * live stages. Never a per-card fetch, never anything remembered about
 * which page was last visited.
 *
 * The next action for each stage is the gate the backend itself uses to
 * move a project out of it (projects_service.advance_stage callers):
 * intake → brief on client intake confirmed; brief → design on creative
 * direction/sitemap approval; design → development on the website build
 * being generated; development → qa on the website being approved; qa →
 * client_review on QA sign-off; client_review → ready_to_deploy on the
 * client's approval being recorded; ready_to_deploy → deployed on a
 * successful deployment; deployed → complete on delivery.
 */
export type ProjectCardBackInput = Pick<Project, "id" | "name" | "client_business_name" | "stage" | "delivered_at">;
export type ProjectCardBackChecklist = Pick<ProjectChecklistSummary, "next_item_title" | "blocked_reason">;
export type ProjectCardBackDeployment = Pick<Deployment, "status" | "created_at">;

export type ProjectCardBack = {
  /** The name shown on the back — the project's, or its business's if the project has none. */
  name: string;
  /** "Delivered" or PROJECT_STAGE_LABELS[stage]; null only for a stage this app doesn't know. */
  stageLabel: string | null;
  /** The next action, or — when `attention` — the specific issue. */
  message: string;
  attention: boolean;
  href: string;
  cta: string;
};

export const CONTINUE_PROJECT = "Continue project →";
export const OPEN_PROJECT = "Open project →";
export const UNKNOWN_NEXT = "Open to see what's next.";

type WebsiteTab = "content" | "preview" | "qa" | "approval" | "deployment";

export function projectHref(projectId: string): string {
  return `/dashboard/projects/${projectId}`;
}

/** The website workspace's own `?tab=` deep link (website/page.tsx's TABS). */
export function projectWebsiteHref(projectId: string, tab: WebsiteTab): string {
  return `/dashboard/projects/${projectId}/website?tab=${tab}`;
}

type Next = { message: string; tab: WebsiteTab | null };

/** The gate out of each stage that has one. Research and the finished stages have none. */
const STAGE_NEXT: Partial<Record<ProjectStage, Next>> = {
  intake: { message: "Confirm the client intake.", tab: null },
  brief: { message: "Approve the creative direction and sitemap.", tab: null },
  design: { message: "Generate the website build.", tab: "content" },
  development: { message: "Review and approve the generated website.", tab: "approval" },
  qa: { message: "Run QA and sign it off.", tab: "qa" },
  client_review: { message: "Record the client's approval.", tab: "approval" },
  revisions: { message: "Work through the client's change requests.", tab: "approval" },
  ready_to_deploy: { message: "Deploy the approved website.", tab: "deployment" },
  deployed: { message: "Finish the delivery checklist, then mark it delivered.", tab: "deployment" },
};

/**
 * The seeded project checklist items (stage_checklists'
 * DEFAULT_PROJECT_STAGE_TASKS) → the screen that holds them. Only used
 * where the stage itself names no gate; a renamed or custom item
 * matches nothing.
 */
const CHECKLIST_NEXT: Record<string, Next> = {
  "Review build inputs": { message: "Review the build inputs.", tab: null },
  "Generate first preview": { message: "Generate the first preview.", tab: "content" },
  "Review desktop and mobile": { message: "Review the preview on desktop and mobile.", tab: "preview" },
  "Complete revisions": { message: "Complete the revisions.", tab: "approval" },
  "Complete QA": { message: "Complete QA.", tab: "qa" },
  "Approve the website for presentation or launch": { message: "Approve the website for presentation or launch.", tab: "approval" },
};

function latestDeployment(deployments: readonly ProjectCardBackDeployment[] | null): ProjectCardBackDeployment | null {
  if (!deployments || deployments.length === 0) return null;
  return deployments.reduce((a, b) => (b.created_at > a.created_at ? b : a));
}

function stageLabelOf(project: ProjectCardBackInput): string | null {
  // A stage outside PROJECT_STAGES (an older/newer API) has no label — say nothing rather than guess.
  return projectStatusLabel(project) ?? null;
}

export function projectCardBack(
  project: ProjectCardBackInput,
  checklist: ProjectCardBackChecklist | undefined,
  /** null while not fetched (or for stages where no deployment can exist yet). */
  deployments: readonly ProjectCardBackDeployment[] | null,
): ProjectCardBack {
  const name = project.name.trim() || project.client_business_name.trim();
  const stageLabel = stageLabelOf(project);
  const base = projectHref(project.id);
  const result = (message: string, href: string, opts: { attention?: boolean; cta?: string } = {}): ProjectCardBack => ({
    name,
    stageLabel,
    message,
    attention: opts.attention ?? false,
    href,
    cta: opts.cta ?? CONTINUE_PROJECT,
  });

  // Genuine failures first, each pointing at where it's resolved. Only
  // the latest attempt counts: a failure a later deployment superseded
  // no longer needs anything.
  const latest = latestDeployment(deployments);
  if (latest?.status === "failed") {
    return result("The last deployment failed. Review it in Deployment.", projectWebsiteHref(project.id, "deployment"), {
      attention: true,
    });
  }
  // The project checklist (StageChecklistPanel) lives on the project page.
  const blocked = checklist?.blocked_reason?.trim();
  if (blocked) return result(`Blocked: ${blocked}`, base, { attention: true });

  // Finished: no invented work, and the same "Open project" the card's menu uses.
  if (project.delivered_at) return result("Delivered — nothing outstanding.", base, { cta: OPEN_PROJECT });
  if (project.stage === "complete") return result("Marked complete — nothing outstanding.", base, { cta: OPEN_PROJECT });
  if (project.stage === "maintenance") return result("In maintenance — the build is finished.", base, { cta: OPEN_PROJECT });

  if (latest && (latest.status === "pending" || latest.status === "running")) {
    return result("A deployment is in progress. Check back when it finishes.", projectWebsiteHref(project.id, "deployment"));
  }

  const next = STAGE_NEXT[project.stage] ?? (checklist?.next_item_title ? CHECKLIST_NEXT[checklist.next_item_title] : undefined);
  if (!next) return result(UNKNOWN_NEXT, base);
  return result(next.message, next.tab ? projectWebsiteHref(project.id, next.tab) : base);
}
