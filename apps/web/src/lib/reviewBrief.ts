import type { BadgeTone } from "@/components/ui/Badge";
import type {
  ChecklistProgress,
  OpportunityScoreCategory,
  QualityFinding,
  QualityFindingSeverity,
} from "./api";

/**
 * Pure helpers behind the discovered-business review brief (the compact
 * card overview on `/dashboard/discovered-businesses/[id]`) — kept out
 * of the components so the "what surfaces at a glance" decisions are
 * unit-testable.
 */

export const SEVERITY_RANK: Record<QualityFindingSeverity, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
};

export const SEVERITY_TONE: Record<QualityFindingSeverity, BadgeTone> = {
  critical: "danger",
  high: "warning",
  medium: "warning",
  low: "muted",
};

export function isHighSeverity(severity: QualityFindingSeverity): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK.high;
}

/** Most severe first, then most confident first; ties keep their stored order. */
export function sortFindings(findings: readonly QualityFinding[]): QualityFinding[] {
  return findings
    .map((finding, index) => ({ finding, index }))
    .sort(
      (a, b) =>
        SEVERITY_RANK[b.finding.severity] - SEVERITY_RANK[a.finding.severity] ||
        b.finding.confidence - a.finding.confidence ||
        a.index - b.index,
    )
    .map(({ finding }) => finding);
}

/**
 * The findings worth surfacing on the audit card itself: up to `limit`
 * high/critical ones. If there are none, the single top finding of any
 * severity, so a card with findings is never blank.
 */
export function topFindings(findings: readonly QualityFinding[], limit = 2): QualityFinding[] {
  const sorted = sortFindings(findings);
  const serious = sorted.filter((f) => isHighSeverity(f.severity));
  return serious.length > 0 ? serious.slice(0, limit) : sorted.slice(0, 1);
}

export type FindingCounts = {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
};

export function findingCounts(findings: readonly QualityFinding[]): FindingCounts {
  const counts: FindingCounts = { total: findings.length, critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return counts;
}

export function highestSeverity(findings: readonly QualityFinding[]): QualityFindingSeverity | null {
  let best: QualityFindingSeverity | null = null;
  for (const f of findings) {
    if (best === null || SEVERITY_RANK[f.severity] > SEVERITY_RANK[best]) best = f.severity;
  }
  return best;
}

/**
 * "Priority" for the summary strip. There is no priority field on a
 * discovered business — it is derived from the opportunity-score
 * category, the one signal the review flow already uses to rank leads
 * (Review Queue sorts by it).
 */
export function reviewPriority(
  category: OpportunityScoreCategory | null | undefined,
): { label: string; tone: BadgeTone } | null {
  switch (category) {
    case "hot":
      return { label: "High", tone: "danger" };
    case "warm":
      return { label: "Medium", tone: "warning" };
    case "cold":
      return { label: "Low", tone: "info" };
    case "review":
      return { label: "Needs review", tone: "muted" };
    default:
      return null;
  }
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** One-line checklist summary — same wording the checklist's own header uses. */
export function checklistSummary(progress: ChecklistProgress): string {
  return progress.required.total === 0
    ? "No applicable tasks"
    : `Required: ${progress.required.completed} of ${progress.required.total} complete`;
}

/** 0–100 for the checklist's required tasks, or null when there are none. */
export function checklistPercent(progress: ChecklistProgress): number | null {
  const { completed, total } = progress.required;
  return total === 0 ? null : Math.round((completed / total) * 100);
}

/** "Google reviews" one-liner, e.g. "4.6 ★ · 127 reviews". */
export function formatRating(rating: number | null, count: number | null): string {
  const parts: string[] = [];
  parts.push(rating !== null ? `${rating.toFixed(1)} ★` : "No rating");
  parts.push(count !== null ? plural(count, "review") : "review count unavailable");
  return parts.join(" · ");
}
