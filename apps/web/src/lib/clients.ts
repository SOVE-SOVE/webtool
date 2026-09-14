/**
 * Pure helpers for the Clients directory + detail view — status, current
 * project, and "what's next" — kept out of the page components so they're
 * unit-testable (same pattern as leads.ts / projects.ts).
 *
 * `Client` itself has no status column (see
 * apps/api/app/modules/clients/models.py) — every row is, by definition,
 * either a won-lead conversion or a manually added referral, so there is
 * no "lead"/"lost" state to represent here. What a client's card should
 * show as "status" is derived from their project(s), the same way
 * `projectTone` derives a badge from `ProjectStage` — no new backend
 * concept invented.
 */

// Relative imports (not "@/lib/…") so this stays runnable under vitest,
// which has no path-alias config — same as projects.ts / api.test.ts.
import type { ActivityItem, Client, Project, Task } from "./api";
import { FINISHED_STAGES } from "./filters";

export function projectsForClient(projects: Project[], clientId: string): Project[] {
  return projects.filter((p) => p.client_id === clientId);
}

export type ClientTone = "onboarding" | "active" | "complete";

export const CLIENT_STATUS_LABEL: Record<ClientTone, string> = {
  onboarding: "Onboarding",
  active: "Active",
  complete: "Complete",
};

/**
 * onboarding = no project started yet (converted/added but intake hasn't
 * begun); active = at least one project still in production; complete =
 * every project has reached a finished stage (deployed/maintenance sit in
 * the "live" tone on Projects, but for a client relationship that's still
 * ongoing delivery — only maintenance/complete count as "wrapped up" here,
 * matching FINISHED_STAGES already used by the Projects page).
 */
export function clientTone(clientProjects: Project[]): ClientTone {
  if (clientProjects.length === 0) return "onboarding";
  if (clientProjects.every((p) => FINISHED_STAGES.includes(p.stage))) return "complete";
  return "active";
}

/** The project to headline on a client's card/overview: the one still in
 *  production if there is one, else the most recently touched. */
export function currentProject(clientProjects: Project[]): Project | null {
  const active = [...clientProjects]
    .filter((p) => !FINISHED_STAGES.includes(p.stage))
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0];
  if (active) return active;
  return [...clientProjects].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0] ?? null;
}

/** One short line: what to do next for this client. */
export function clientNextAction(project: Project | null, nextTaskTitle: string | null): string {
  if (!project) return "Start intake";
  return nextTaskTitle ?? "No open tasks";
}

/** Most recent activity row across a client's own log and its project(s). */
export function mostRecentActivity(
  activity: ActivityItem[],
  client: Pick<Client, "id">,
  clientProjects: Project[],
): ActivityItem | null {
  const projectIds = new Set(clientProjects.map((p) => p.id));
  const relevant = activity.filter(
    (a) =>
      (a.entity_type === "client" && a.entity_id === client.id) ||
      (a.entity_type === "project" && projectIds.has(a.entity_id)),
  );
  return relevant.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] ?? null;
}

export function openTaskCount(tasks: Task[], projectId: string | null): number {
  if (!projectId) return 0;
  return tasks.filter((t) => t.project_id === projectId && !t.done).length;
}
