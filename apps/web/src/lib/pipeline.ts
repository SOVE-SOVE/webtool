/**
 * Pure logic behind the pipeline kanban board: grouping leads by stage
 * and flagging ones that need attention. Kept out of the page component
 * so it's unit-testable without a DOM — same pattern as filters.ts.
 */

import type { Lead, LeadStatus, PipelineStage } from "@/lib/api";

// Same "no movement in 5 days" convention as the Overview's stale-lead
// "needs attention" signal (apps/api/app/modules/dashboard/service.py's
// STALE_LEAD_THRESHOLD) — a UI hint here, not re-derived server-side.
export const STALE_DAYS = 5;

export function daysSince(iso: string, now: number = Date.now()): number {
  return Math.floor((now - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

export function isStale(lead: Lead, stage: PipelineStage | undefined, now: number = Date.now()): boolean {
  if (!stage || stage.is_won || stage.is_lost) return false;
  return daysSince(lead.updated_at, now) >= STALE_DAYS;
}

export function orderStages(stages: PipelineStage[]): PipelineStage[] {
  return [...stages].sort((a, b) => a.sort_order - b.sort_order);
}

export function groupLeadsByStatus(leads: Lead[]): Map<LeadStatus, Lead[]> {
  const map = new Map<LeadStatus, Lead[]>();
  for (const lead of leads) {
    const bucket = map.get(lead.status);
    if (bucket) bucket.push(lead);
    else map.set(lead.status, [lead]);
  }
  return map;
}

export function stageByKey(stages: PipelineStage[]): Map<LeadStatus, PipelineStage> {
  const map = new Map<LeadStatus, PipelineStage>();
  for (const stage of stages) map.set(stage.key, stage);
  return map;
}

export function countStale(leads: Lead[], stages: PipelineStage[], now: number = Date.now()): number {
  const byKey = stageByKey(stages);
  return leads.filter((lead) => isStale(lead, byKey.get(lead.status), now)).length;
}
