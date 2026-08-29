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

import type { Lead, LeadStatus } from "@/lib/api";

export type LeadTab = "all" | "new" | "contacted" | "interested" | "proposal" | "won" | "lost" | "nurture";

export type LeadTabDef = {
  id: LeadTab;
  label: string;
  /** null = every status (the "All" tab). */
  statuses: LeadStatus[] | null;
};

// Ordered left→right as the lifecycle runs:
// Lead → Contacted → Interested → Proposal → Won  (Lost / Nurture off to the side)
export const LEAD_TABS: LeadTabDef[] = [
  { id: "all", label: "All", statuses: null },
  { id: "new", label: "New", statuses: ["new", "researched", "qualified"] },
  { id: "contacted", label: "Contacted", statuses: ["contacted"] },
  { id: "interested", label: "Interested", statuses: ["replied", "meeting"] },
  { id: "proposal", label: "Proposal", statuses: ["proposal"] },
  { id: "won", label: "Won", statuses: ["won"] },
  { id: "lost", label: "Lost", statuses: ["lost"] },
  { id: "nurture", label: "Nurture", statuses: ["nurture"] },
];

const TAB_IDS = new Set(LEAD_TABS.map((t) => t.id));

export function isLeadTab(value: string | null | undefined): value is LeadTab {
  return value != null && TAB_IDS.has(value as LeadTab);
}

export function statusesForTab(tab: LeadTab): LeadStatus[] | null {
  return LEAD_TABS.find((t) => t.id === tab)?.statuses ?? null;
}

export function leadMatchesTab(lead: Pick<Lead, "status">, tab: LeadTab): boolean {
  const statuses = statusesForTab(tab);
  return statuses === null || statuses.includes(lead.status);
}

/** Count of (non-archived) leads in each tab, for the tab-bar badges. */
export function countLeadsByTab(leads: Pick<Lead, "status" | "archived_at">[]): Record<LeadTab, number> {
  const counts = Object.fromEntries(LEAD_TABS.map((t) => [t.id, 0])) as Record<LeadTab, number>;
  for (const lead of leads) {
    if (lead.archived_at) continue;
    for (const tab of LEAD_TABS) {
      if (leadMatchesTab(lead, tab.id)) counts[tab.id] += 1;
    }
  }
  return counts;
}
