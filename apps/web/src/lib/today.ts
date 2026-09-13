/**
 * Pure logic behind the Today workspace: "what should I do next", the
 * five-stage pipeline view, and where a piece of recent activity links
 * to. Every number here is derived from data the app already fetches
 * elsewhere (leads, planning, the review queue, projects, activity) —
 * nothing invented, no client-side scoring or conversion-rate math.
 * Kept out of the page component so it's unit-testable, same pattern as
 * filters.ts / leads.ts / pipeline.ts.
 */

import type { ActivityItem, AttentionItem, CalendarEvent, Lead, PlanningListItem, Project } from "./api";
import { LIVE_STAGES } from "./filters";
import { leadMatchesTab } from "./leads";

// Statuses a lead can be "ready to start Planning" from — past the
// initial triage in the "new" tab, and not off to the side (lost /
// nurturing). Whether Planning has actually been started is the other
// half of the check, done against the Planning list's own lead_ids.
const PLANNING_READY_STATUSES = new Set<Lead["status"]>([
  "qualified",
  "contacted",
  "replied",
  "meeting",
  "proposal",
  "won",
]);

export type NextAction = {
  id: string;
  count: number;
  label: string;
  href: string;
};

export function computeNextActions(input: {
  leads: Pick<Lead, "id" | "status" | "archived_at">[];
  planning: Pick<PlanningListItem, "lead_id" | "status">[];
  projects: Pick<Project, "stage">[];
}): NextAction[] {
  const activeLeads = input.leads.filter((l) => !l.archived_at);
  const planningLeadIds = new Set(input.planning.map((p) => p.lead_id));

  const newLeadsCount = activeLeads.filter((l) => leadMatchesTab(l, "new")).length;
  const readyForPlanningCount = activeLeads.filter(
    (l) => PLANNING_READY_STATUSES.has(l.status) && !planningLeadIds.has(l.id),
  ).length;
  const planningNeedsReviewCount = input.planning.filter((p) => p.status === "needs_review").length;
  const readyToBuildCount = input.projects.filter((p) => p.stage === "intake").length;

  const actions: NextAction[] = [];
  if (newLeadsCount > 0) {
    actions.push({
      id: "new-leads",
      count: newLeadsCount,
      label: `${newLeadsCount} new lead${newLeadsCount === 1 ? "" : "s"} to review`,
      href: "/dashboard/leads?tab=new",
    });
  }
  if (readyForPlanningCount > 0) {
    actions.push({
      id: "ready-for-planning",
      count: readyForPlanningCount,
      label: `${readyForPlanningCount} lead${readyForPlanningCount === 1 ? "" : "s"} ready to start Planning`,
      href: "/dashboard/leads",
    });
  }
  if (planningNeedsReviewCount > 0) {
    actions.push({
      id: "planning-needs-review",
      count: planningNeedsReviewCount,
      label: `${planningNeedsReviewCount} Planning audit${planningNeedsReviewCount === 1 ? "" : "s"} needing review`,
      href: "/dashboard/planning",
    });
  }
  if (readyToBuildCount > 0) {
    actions.push({
      id: "projects-ready-to-build",
      count: readyToBuildCount,
      label: `${readyToBuildCount} project${readyToBuildCount === 1 ? "" : "s"} ready to build`,
      href: "/dashboard/projects?stage=intake",
    });
  }
  return actions;
}

export type PipelineStageId = "discovery" | "leads" | "planning" | "projects" | "live";

export type PipelineStageView = {
  id: PipelineStageId;
  label: string;
  count: number;
  href: string;
  /** Shown instead of a bare "0" when this stage is empty — a nudge toward the upstream fix, not just a dead number. */
  empty?: { label: string; href: string };
};

export function computePipelineStages(input: {
  reviewQueueCount: number;
  leadsCount: number;
  planningCount: number;
  projects: Pick<Project, "stage">[];
}): PipelineStageView[] {
  const projectsInBuildCount = input.projects.filter((p) => !LIVE_STAGES.includes(p.stage)).length;
  const liveCount = input.projects.filter((p) => LIVE_STAGES.includes(p.stage)).length;

  return [
    { id: "discovery", label: "Discovery", count: input.reviewQueueCount, href: "/dashboard/review" },
    {
      id: "leads",
      label: "Leads",
      count: input.leadsCount,
      href: "/dashboard/leads",
      empty: input.leadsCount === 0 ? { label: "Open Map Discovery", href: "/dashboard/discovery" } : undefined,
    },
    {
      id: "planning",
      label: "Planning",
      count: input.planningCount,
      href: "/dashboard/planning",
      empty: input.planningCount === 0 ? { label: "Review Leads", href: "/dashboard/leads" } : undefined,
    },
    {
      id: "projects",
      label: "Projects",
      count: projectsInBuildCount,
      href: "/dashboard/projects",
      empty: projectsInBuildCount === 0 ? { label: "Open Planning", href: "/dashboard/planning" } : undefined,
    },
    { id: "live", label: "Live", count: liveCount, href: "/dashboard/projects?view=live" },
  ];
}

const ENTITY_HREF: Record<string, (id: string) => string> = {
  lead: (id) => `/dashboard/leads/${id}`,
  project: (id) => `/dashboard/projects/${id}`,
  client: (id) => `/dashboard/clients/${id}`,
  task: () => "/dashboard/tasks",
  meeting: () => "/dashboard/calendar",
  discovered_business: (id) => `/dashboard/discovered-businesses/${id}`,
  discovery_search: (id) => `/dashboard/discovery/${id}`,
};

/** Where a Recent Activity row should link to, from its entity_type/entity_id — falls back to Today itself for an entity_type this map hasn't been taught yet. */
export function activityHref(item: Pick<ActivityItem, "entity_type" | "entity_id">): string {
  const resolve = ENTITY_HREF[item.entity_type];
  return resolve ? resolve(item.entity_id) : "/dashboard";
}

export type AttentionPriority = "high" | "medium" | "low";

/**
 * A coarse High/Medium/Low tier for an attention row, derived from the
 * `kind` + `detail` text the API already returns rather than a field the
 * backend doesn't expose. This deliberately approximates (not
 * reproduces) the server's own tie-break order — see
 * apps/api/app/modules/dashboard/service.py's `_OVERDUE_FOLLOW_UP` /
 * `_IMMINENT_MEETING` / `_STALE_LEAD` tier constants, which this mirrors
 * at the kind level: overdue items and imminent meetings/blocked
 * projects read High, a stale lead reads Low, everything else Medium.
 */
export function attentionPriority(item: Pick<AttentionItem, "kind" | "detail">): AttentionPriority {
  if (item.kind === "stale_lead") return "low";
  if (item.kind === "meeting" || item.kind === "project") return "high";
  return item.detail.toLowerCase().includes("overdue") ? "high" : "medium";
}

/** Short right-aligned status word for an attention row, paired with attentionPriority's tone. */
export function attentionTag(item: Pick<AttentionItem, "kind" | "detail">): string {
  if (item.detail.toLowerCase().includes("overdue")) return "Overdue";
  switch (item.kind) {
    case "follow_up":
      return "Due today";
    case "meeting":
      return "Meeting soon";
    case "project":
      return "Action needed";
    case "stale_lead":
      return "Gone quiet";
    default:
      return "Due";
  }
}

/** Today's calendar events (meetings + tasks due today), not-yet-done, earliest first. */
export function todaysScheduleEvents(
  events: Pick<CalendarEvent, "kind" | "id" | "title" | "at" | "detail" | "done" | "href">[],
): Pick<CalendarEvent, "kind" | "id" | "title" | "at" | "detail" | "done" | "href">[] {
  return events.filter((e) => !e.done).sort((a, b) => a.at.localeCompare(b.at));
}
