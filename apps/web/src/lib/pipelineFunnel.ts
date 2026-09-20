/**
 * Pure logic behind the Today overview's pipeline funnel: one segment
 * per pipeline stage, in stage order, sized by how many leads sit at it.
 * Built from the two endpoints that already exist — `listLeads` (each
 * lead's status) and `listPipelineStages` (the workspace's stage labels,
 * order and won/lost flags) — so it decides nothing the server doesn't
 * already know. Kept out of the component so it's unit-testable.
 */

import { LEAD_STATUSES, type Lead, type LeadStatus, type PipelineStage } from "./api";
import { LEAD_STATUS_LABEL } from "./leads";

export type FunnelTone = "active" | "won" | "lost" | "parked";

export type FunnelSegment = {
  key: LeadStatus;
  label: string;
  count: number;
  /** count / total, 0–1 (0 when the funnel is empty). */
  share: number;
  tone: FunnelTone;
  /** 0–1 position among the active stages, for a light→dark ramp; 0 for the rest. */
  depth: number;
};

export type Funnel = {
  segments: FunnelSegment[];
  /** Leads counted in the segments. */
  total: number;
};

type StageInput = Pick<PipelineStage, "key" | "label" | "sort_order" | "is_won" | "is_lost">;

/** The Leads list URL pre-filtered to exactly one stage (see the Leads page's `status` filter). */
export function leadsHrefForStage(status: LeadStatus): string {
  return `/dashboard/sales/leads?status=${status}`;
}

function toneOf(stage: StageInput): FunnelTone {
  if (stage.is_won) return "won";
  if (stage.is_lost) return "lost";
  return stage.key === "nurture" ? "parked" : "active";
}

/**
 * `stages` null/empty (the stages request failed or hasn't seeded) falls
 * back to the raw status order with its plain labels, so the funnel still
 * renders. Archived leads are never counted — the same rule as the Leads
 * list — but converted leads are: a won-and-converted deal is still a won
 * deal, and the click-through (`status` filter) shows them too.
 */
export function buildFunnel(
  stages: readonly StageInput[] | null,
  leads: readonly Pick<Lead, "status" | "archived_at">[],
): Funnel {
  const ordered: StageInput[] =
    stages && stages.length > 0
      ? [...stages].sort((a, b) => a.sort_order - b.sort_order)
      : LEAD_STATUSES.map((key, i) => ({
          key,
          label: LEAD_STATUS_LABEL[key],
          sort_order: i,
          is_won: key === "won",
          is_lost: key === "lost",
        }));

  const counts = new Map<LeadStatus, number>();
  for (const lead of leads) {
    if (lead.archived_at) continue;
    counts.set(lead.status, (counts.get(lead.status) ?? 0) + 1);
  }

  const total = ordered.reduce((sum, s) => sum + (counts.get(s.key) ?? 0), 0);
  const activeCount = ordered.filter((s) => toneOf(s) === "active").length;
  let activeIndex = 0;

  const segments = ordered.map((stage): FunnelSegment => {
    const count = counts.get(stage.key) ?? 0;
    const tone = toneOf(stage);
    const depth = tone === "active" ? (activeCount > 1 ? activeIndex / (activeCount - 1) : 1) : 0;
    if (tone === "active") activeIndex += 1;
    return { key: stage.key, label: stage.label, count, share: total > 0 ? count / total : 0, tone, depth };
  });

  return { segments, total };
}
