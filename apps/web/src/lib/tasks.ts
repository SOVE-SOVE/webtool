/**
 * Pure logic behind the Tasks page: which bucket a task's due date puts
 * it in, the status-tab filter, and the "what project/lead is this
 * filed under" grouping used by both the filter dropdown and each row's
 * link. Kept out of the page component so it's unit-testable — same
 * pattern as filters.ts / leads.ts / projects.ts.
 *
 * The Task model has no priority field (only Leads do — see
 * LeadPriority in api.ts), so "how important is this" on this page
 * comes from urgency (how close/overdue the due date is), not a
 * fabricated priority value.
 */

import type { Task } from "./api";

const MS_PER_DAY = 86_400_000;

export type TaskUrgency = "overdue" | "today" | "upcoming" | "none";

/** Which urgency bucket a task's due date falls into, "none" if undated. */
export function taskUrgency(task: Pick<Task, "due_at">, now: number = Date.now()): TaskUrgency {
  if (!task.due_at) return "none";
  const due = new Date(task.due_at).getTime();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  if (due < startOfToday.getTime()) return "overdue";
  if (due < startOfToday.getTime() + MS_PER_DAY) return "today";
  return "upcoming";
}

export type TaskGroups = {
  overdue: Task[];
  today: Task[];
  upcoming: Task[];
  noDueDate: Task[];
};

/**
 * Buckets the not-done tasks by urgency, each bucket soonest-due first
 * (undated tasks by creation order). Done tasks are excluded — they get
 * their own flat list elsewhere so completed work never mixes into the
 * active queue.
 */
export function groupOpenTasksByUrgency(tasks: Task[], now: number = Date.now()): TaskGroups {
  const groups: TaskGroups = { overdue: [], today: [], upcoming: [], noDueDate: [] };
  for (const task of tasks) {
    if (task.done) continue;
    switch (taskUrgency(task, now)) {
      case "overdue":
        groups.overdue.push(task);
        break;
      case "today":
        groups.today.push(task);
        break;
      case "upcoming":
        groups.upcoming.push(task);
        break;
      case "none":
        groups.noDueDate.push(task);
        break;
    }
  }
  const byDueDate = (a: Task, b: Task) => new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime();
  groups.overdue.sort(byDueDate);
  groups.today.sort(byDueDate);
  groups.upcoming.sort(byDueDate);
  groups.noDueDate.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return groups;
}

export type TaskTab = "open" | "all" | "done";

export const TASK_TABS: { id: TaskTab; label: string }[] = [
  { id: "open", label: "To do" },
  { id: "all", label: "All" },
  { id: "done", label: "Completed" },
];

export function taskMatchesTab(task: Pick<Task, "done">, tab: TaskTab): boolean {
  if (tab === "open") return !task.done;
  if (tab === "done") return task.done;
  return true;
}

/** The task's `context` string ("Project: X" / "Lead: Y") with the prefix stripped, for display. */
export function taskContextName(task: Pick<Task, "context">): string {
  return task.context.replace(/^(Project|Lead): /, "");
}

export function taskContextKind(task: Pick<Task, "project_id" | "lead_id">): "project" | "lead" {
  return task.project_id ? "project" : "lead";
}

/** Where clicking the task's project/lead name should go. */
export function taskContextHref(task: Pick<Task, "project_id" | "lead_id">): string {
  return task.project_id ? `/dashboard/projects/${task.project_id}` : `/dashboard/leads/${task.lead_id}`;
}

/** Stable key identifying which project or lead a task is filed under, for filtering. */
export function taskFilterKey(task: Pick<Task, "project_id" | "lead_id">): string {
  return task.project_id ? `project:${task.project_id}` : `lead:${task.lead_id}`;
}

export function taskMatchesFilter(task: Pick<Task, "project_id" | "lead_id">, filterKey: string): boolean {
  return filterKey === "" || taskFilterKey(task) === filterKey;
}

export type TaskFilterOption = { key: string; label: string };

/** One option per distinct project/lead actually referenced by these tasks, alphabetical. */
export function listTaskFilterOptions(tasks: Task[]): TaskFilterOption[] {
  const seen = new Map<string, string>();
  for (const task of tasks) {
    const key = taskFilterKey(task);
    if (!seen.has(key)) seen.set(key, taskContextName(task));
  }
  return [...seen.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function taskMatchesSearch(task: Pick<Task, "title" | "context">, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return task.title.toLowerCase().includes(q) || task.context.toLowerCase().includes(q);
}
