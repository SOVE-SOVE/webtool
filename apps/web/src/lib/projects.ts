/**
 * Pure helpers for the Projects views — progress, phase, deadline
 * status. Kept out of the page components so they're unit-testable
 * (same pattern as filters.ts / pipeline.ts / leads.ts).
 *
 * Nothing here fabricates data: "progress" is derived from where the
 * project actually sits in the fixed `ProjectStage` sequence, or (on the
 * detail page, where the approval checkpoints are already fetched) from
 * how many of those real gates have been approved.
 */

// Relative imports (not "@/lib/…") so this stays runnable under vitest,
// which has no path-alias config — same as api.test.ts / overview.ts.
import { PROJECT_STAGE_LABELS, PROJECT_STAGES, type Project, type ProjectStage, type Task } from "./api";
import { FINISHED_STAGES } from "./filters";

const LIVE_STAGES: ProjectStage[] = ["deployed", "maintenance", "complete"];

/** 0–100, from the project's position in the fixed stage sequence. */
export function stageProgress(stage: ProjectStage): number {
  const i = PROJECT_STAGES.indexOf(stage);
  if (i <= 0) return 0;
  return Math.round((i / (PROJECT_STAGES.length - 1)) * 100);
}

/** 0–100, from how many approval checkpoints have actually been approved. */
export function checkpointProgress(checkpoints: { approved: boolean }[]): number {
  if (checkpoints.length === 0) return 0;
  return Math.round((checkpoints.filter((c) => c.approved).length / checkpoints.length) * 100);
}

export type ProjectTone = "planning" | "building" | "review" | "live" | "done";

/** Coarse status grouping so the badge has ~5 meanings, not 12 colours. */
export function projectTone(project: Pick<Project, "stage" | "delivered_at">): ProjectTone {
  if (project.delivered_at || project.stage === "complete") return "done";
  if (LIVE_STAGES.includes(project.stage)) return "live";
  if (project.stage === "qa" || project.stage === "client_review" || project.stage === "revisions") return "review";
  if (project.stage === "design" || project.stage === "development") return "building";
  return "planning";
}

/** What to show as the project's headline status. */
export function projectStatusLabel(project: Pick<Project, "stage" | "delivered_at">): string {
  if (project.delivered_at) return "Delivered";
  return PROJECT_STAGE_LABELS[project.stage];
}

export function isFinished(project: Pick<Project, "stage">): boolean {
  return FINISHED_STAGES.includes(project.stage);
}

export { FINISHED_STAGES };

/** The first not-done task attached to this project, if any. */
export function nextOpenTask(tasks: Task[], projectId: string): Task | null {
  return (
    tasks
      .filter((t) => t.project_id === projectId && !t.done)
      .sort((a, b) => {
        // Overdue/soonest first; undated last.
        if (a.due_at && b.due_at) return a.due_at < b.due_at ? -1 : 1;
        if (a.due_at) return -1;
        if (b.due_at) return 1;
        return a.created_at < b.created_at ? -1 : 1;
      })[0] ?? null
  );
}

export type DeadlineStatus = "none" | "overdue" | "soon" | "ok";

export function deadlineStatus(deadline: string | null, now: number = Date.now()): DeadlineStatus {
  if (!deadline) return "none";
  const days = (new Date(deadline).getTime() - now) / 86_400_000;
  if (days < 0) return "overdue";
  if (days <= 7) return "soon";
  return "ok";
}
