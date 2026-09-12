"use client";

import { useState } from "react";
import type { Planning, PlanningKeyPoint } from "@/lib/api";
import { Disclosure } from "@/components/ui/Disclosure";
import { AREA_LABELS, SEVERITY_CLASS, SEVERITY_LABEL, groupByArea } from "../lib";
import { EvidencePanel } from "./SidePanels";

const AREA_ORDER = ["technical", "usability", "seo", "accessibility", "visual"];
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function worstSeverityRank(points: PlanningKeyPoint[]): number {
  return points.reduce((min, p) => Math.min(min, SEVERITY_RANK[p.severity] ?? 4), 4);
}

function FindingItem({ point }: { point: PlanningKeyPoint }) {
  const [showEvidence, setShowEvidence] = useState(false);
  return (
    <li className="rounded-md border border-border p-2.5 text-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="text-fg">{point.message}</span>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${SEVERITY_CLASS[point.severity] ?? SEVERITY_CLASS.low}`}
        >
          {SEVERITY_LABEL[point.severity] ?? point.severity}
        </span>
      </div>
      <button
        type="button"
        onClick={() => setShowEvidence((v) => !v)}
        className="mt-1.5 text-xs text-fg-muted hover:text-fg hover:underline"
      >
        {showEvidence ? "Hide evidence" : "Show evidence"}
      </button>
      {showEvidence && <p className="mt-1 text-xs text-fg-subtle">{point.evidence}</p>}
    </li>
  );
}

/**
 * The complete audit — every recorded finding across all five areas
 * (agents/planning_audit.py + agents/planning_visual_review.py),
 * grouped and collapsed by default so the page isn't a wall of text;
 * the worst area opens first. Evidence for each finding is itself
 * behind a second, per-finding disclosure — the "important finding and
 * its state first" progressive-disclosure rule applies at both levels.
 */
export function AuditTab({ planning }: { planning: Planning }) {
  const hasAudit = planning.website_audit_id !== null;

  if (!hasAudit) {
    return (
      <div className="rounded-md border border-dashed border-border px-6 py-12 text-center">
        <p className="text-sm font-medium text-fg">No audit findings yet</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-fg-muted">
          Run &ldquo;Analyse Website&rdquo; from the Overview tab to see the full technical, SEO, mobile,
          accessibility, visual, and usability findings here.
        </p>
      </div>
    );
  }

  const grouped = groupByArea(planning.key_points).sort(([a, aPoints], [b, bPoints]) => {
    const rankDiff = worstSeverityRank(aPoints) - worstSeverityRank(bPoints);
    if (rankDiff !== 0) return rankDiff;
    return AREA_ORDER.indexOf(a) - AREA_ORDER.indexOf(b);
  });

  const hasScreenshots = Boolean(planning.screenshot_desktop_base64 || planning.screenshot_mobile_base64);

  return (
    <div className="space-y-3">
      {grouped.length === 0 ? (
        <p className="text-sm text-fg-muted">No issues found in this analysis.</p>
      ) : (
        grouped.map(([area, points], i) => (
          <Disclosure
            key={area}
            defaultOpen={i === 0}
            title={AREA_LABELS[area] ?? area}
            hint={`${points.length} finding${points.length === 1 ? "" : "s"}`}
            badge={
              worstSeverityRank(points) <= 1 ? (
                <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-500/15 dark:text-red-300">
                  Needs attention
                </span>
              ) : undefined
            }
          >
            <ul className="space-y-2">
              {points.map((point, j) => (
                <FindingItem key={j} point={point} />
              ))}
            </ul>
          </Disclosure>
        ))
      )}

      {hasScreenshots && (
        <Disclosure title="Screenshots" hint="Desktop and mobile evidence captured during the audit">
          <EvidencePanel planning={planning} />
        </Disclosure>
      )}
    </div>
  );
}
