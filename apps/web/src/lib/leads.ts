/**
 * The Leads page's lifecycle grouping. Pure + unit-tested (same pattern
 * as filters.ts / pipeline.ts), kept out of the page component.
 *
 * The tabs are a *plain-language grouping over the existing `LeadStatus`
 * enum* — they do not add or rename any status. A lead's real status
 * (all ten values) is still what's stored and still fully editable; the
 * tab is only a filter. This is why Pipeline (a board over the same
 * statuses) and this page can coexist without conflicting — see
 * docs/05_DECISIONS.md (2026-08-16, LeadStatus replaces LeadStage).
 */

import type { Lead, LeadPriority, LeadStatus } from "@/lib/api";

export type LeadTab =
  | "all"
  | "new"
  | "contacted"
  | "interested"
  | "proposal"
  | "won"
  | "converted"
  | "lost"
  | "nurture";

export type LeadTabDef = {
  id: LeadTab;
  label: string;
  /** null = every status (the "All" tab). Ignored for "converted",
   * which matches on `client_id` instead — see leadMatchesTab. */
  statuses: LeadStatus[] | null;
};

// Ordered left→right as the lifecycle runs:
// Lead → Contacted → Interested → Proposal → Won → Converted  (Lost / Nurture off to the side)
//
// "Won" and "Converted" are deliberately separate: a lead can reach
// `status === "won"` (a pipeline-board move, "the deal is agreed")
// with no Client ever created — conversion to Client is always a
// separate, explicit operator action (docs/05_DECISIONS.md). Every
// tab except "converted" itself excludes an already-converted lead —
// see leadMatchesTab — so a converted lead disappears from the
// active/default views once it's actually a Client.
export const LEAD_TABS: LeadTabDef[] = [
  { id: "all", label: "All", statuses: null },
  { id: "new", label: "New", statuses: ["new", "researched", "qualified"] },
  { id: "contacted", label: "Contacted", statuses: ["contacted"] },
  { id: "interested", label: "Interested", statuses: ["replied", "meeting"] },
  { id: "proposal", label: "Proposal", statuses: ["proposal"] },
  { id: "won", label: "Won", statuses: ["won"] },
  { id: "converted", label: "Converted", statuses: null },
  { id: "lost", label: "Lost", statuses: ["lost"] },
  { id: "nurture", label: "Nurture", statuses: ["nurture"] },
];

/**
 * Human-readable label for each raw `LeadStatus` value. The enum values
 * are unchanged and still stored/edited everywhere — this is display
 * only, for badges and lists.
 */
export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  researched: "Researched",
  qualified: "Qualified",
  contacted: "Contacted",
  replied: "Replied",
  meeting: "Meeting booked",
  proposal: "Proposal sent",
  won: "Won",
  lost: "Lost",
  nurture: "Nurturing",
};

/**
 * Coarse grouping so a status badge has ~5 meanings, not 10 colours —
 * same idea as `projectTone` in projects.ts. Mirrors the `LEAD_TABS`
 * lifecycle groups: New (new/researched/qualified), Active (anything in
 * the live funnel), Won, Lost, Nurture.
 */
export type LeadTone = "new" | "active" | "won" | "lost" | "nurture";

export function leadTone(status: LeadStatus): LeadTone {
  if (status === "won") return "won";
  if (status === "lost") return "lost";
  if (status === "nurture") return "nurture";
  if (status === "new" || status === "researched" || status === "qualified") return "new";
  return "active";
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * One short line answering "what should I do with this lead next" for
 * the Leads list. A scheduled follow-up wins; otherwise a hint derived
 * from the current status. Pure — `now` is injectable for tests.
 */
export function leadNextAction(
  lead: Pick<Lead, "status" | "client_id">,
  nextFollowUp?: string | null,
  now: number = Date.now(),
): string {
  if (lead.client_id != null) return "Open the client record";
  if (nextFollowUp) {
    const due = new Date(nextFollowUp);
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const dueDay = new Date(due);
    dueDay.setHours(0, 0, 0, 0);
    const diffDays = Math.round((dueDay.getTime() - startOfToday.getTime()) / MS_PER_DAY);
    if (diffDays < 0) return "Follow-up overdue";
    if (diffDays === 0) return "Follow up today";
    return `Follow up ${due.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
  }
  switch (lead.status) {
    case "new":
    case "researched":
    case "qualified":
      return "Needs first contact";
    case "contacted":
      return "Waiting on a reply";
    case "replied":
    case "meeting":
      return "Move toward a proposal";
    case "proposal":
      return "Chase the proposal";
    case "won":
      return "Convert to a client";
    case "nurture":
      return "Check back later";
    case "lost":
      return "—";
  }
}

const TAB_IDS = new Set(LEAD_TABS.map((t) => t.id));

export function isLeadTab(value: string | null | undefined): value is LeadTab {
  return value != null && TAB_IDS.has(value as LeadTab);
}

export function statusesForTab(tab: LeadTab): LeadStatus[] | null {
  return LEAD_TABS.find((t) => t.id === tab)?.statuses ?? null;
}

export function leadMatchesTab(lead: Pick<Lead, "status" | "client_id">, tab: LeadTab): boolean {
  if (tab === "converted") return lead.client_id != null;
  // An already-converted lead is a Client now — hidden from every
  // other tab (including "all" and "won") once conversion happens.
  if (lead.client_id != null) return false;
  const statuses = statusesForTab(tab);
  return statuses === null || statuses.includes(lead.status);
}

/** Count of (non-archived) leads in each tab, for the tab-bar badges. */
export function countLeadsByTab(leads: Pick<Lead, "status" | "archived_at" | "client_id">[]): Record<LeadTab, number> {
  const counts = Object.fromEntries(LEAD_TABS.map((t) => [t.id, 0])) as Record<LeadTab, number>;
  for (const lead of leads) {
    if (lead.archived_at) continue;
    for (const tab of LEAD_TABS) {
      if (leadMatchesTab(lead, tab.id)) counts[tab.id] += 1;
    }
  }
  return counts;
}

/**
 * Leads list sort options. "updated" (the long-standing default) is
 * recency; the other three surface commercial value or urgency first,
 * for "which of these is worth my time right now."
 */
export const LEAD_SORTS = ["updated", "priority", "score", "follow_up"] as const;
export type LeadSort = (typeof LEAD_SORTS)[number];

export const LEAD_SORT_LABEL: Record<LeadSort, string> = {
  updated: "Recently updated",
  priority: "Priority",
  score: "Score",
  follow_up: "Follow-up soonest",
};

const PRIORITY_RANK: Record<LeadPriority, number> = { high: 0, medium: 1, low: 2 };

/**
 * Sorts leads for the list view. Archived leads always sink to the
 * bottom regardless of sort, then the chosen dimension breaks ties —
 * falling back to most-recently-updated when a lead has nothing to
 * compare on (e.g. no score, no follow-up).
 */
export function sortLeads(
  leads: Lead[],
  sort: LeadSort,
  nextFollowUpByLead?: Map<string, string>,
): Lead[] {
  const byRecency = (a: Lead, b: Lead) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  return [...leads].sort((a, b) => {
    if (!!a.archived_at !== !!b.archived_at) return a.archived_at ? 1 : -1;
    switch (sort) {
      case "priority": {
        const diff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        return diff !== 0 ? diff : byRecency(a, b);
      }
      case "score": {
        if (a.score === null && b.score === null) return byRecency(a, b);
        if (a.score === null) return 1;
        if (b.score === null) return -1;
        return b.score - a.score;
      }
      case "follow_up": {
        const fa = nextFollowUpByLead?.get(a.id);
        const fb = nextFollowUpByLead?.get(b.id);
        if (!fa && !fb) return byRecency(a, b);
        if (!fa) return 1;
        if (!fb) return -1;
        return fa < fb ? -1 : fa > fb ? 1 : byRecency(a, b);
      }
      case "updated":
      default:
        return byRecency(a, b);
    }
  });
}
