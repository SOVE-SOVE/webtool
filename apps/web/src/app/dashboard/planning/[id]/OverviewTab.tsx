"use client";

import { useState } from "react";
import { api, type Planning } from "@/lib/api";
import {
  ROW_STATE_DOT,
  ROW_STATE_LABEL,
  computeAuditRows,
  computeTopOpportunities,
  type AuditRow,
  type Opportunity,
} from "../lib";
import { AnalyseWebsiteAction } from "./AnalyseWebsiteAction";
import { AutoSaveTextarea } from "./AutoSaveTextarea";
import { EvidencePanel, NotesPreview } from "./SidePanels";

type Evidence = { label: string; text: string };

/**
 * The default, decision-focused tab: top opportunities, the neutral
 * website summary, and a compact per-dimension status list, with the
 * screenshot/evidence panel alongside on desktop. Deliberately excludes
 * anything that belongs to progressive disclosure (full findings live
 * in the Website Audit tab).
 */
export function OverviewTab({
  planning,
  onUpdated,
  onOpenAuditTab,
  onOpenNotesTab,
}: {
  planning: Planning;
  onUpdated: (p: Planning) => void;
  onOpenAuditTab: () => void;
  onOpenNotesTab: () => void;
}) {
  const hasAudit = planning.website_audit_id !== null;
  const opportunities = computeTopOpportunities(planning);
  const rows = computeAuditRows(planning);
  const [selected, setSelected] = useState<Evidence | null>(null);

  async function handleSaveSummary(value: string) {
    onUpdated(await api.updatePlanning(planning.id, { website_summary: value }));
  }

  function selectOpportunity(o: Opportunity) {
    setSelected({ label: o.source === "audit" ? "Evidence" : "Based on Google reviews", text: o.basis });
  }

  function selectRow(row: AuditRow) {
    if (row.key === "google_reviews") {
      const review = planning.review_intelligence;
      if (!review) return;
      const parts: string[] = [];
      if (review.google_rating !== null) parts.push(`${review.google_rating.toFixed(1)}★`);
      if (review.google_review_count !== null) parts.push(`${review.google_review_count} review(s)`);
      setSelected({
        label: "Google reviews",
        text: parts.length > 0 ? parts.join(" · ") : "See the Google Review Insights tab for details.",
      });
      return;
    }
    if (row.points.length === 0) return;
    setSelected({ label: `${row.label} — evidence`, text: row.points[0].evidence });
  }

  if (!hasAudit) {
    return <AnalyseWebsiteAction planning={planning} onAnalysed={onUpdated} />;
  }

  const opportunitiesSection = (
    <section>
      <h2 className="section-title">Top opportunities</h2>
      {opportunities.length === 0 ? (
        <p className="mt-1.5 text-sm text-fg-muted">No notable opportunities identified from this analysis.</p>
      ) : (
        <ol className="mt-2 space-y-1.5">
          {opportunities.map((o, i) => (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => selectOpportunity(o)}
                className="flex w-full items-start gap-2.5 rounded-md border border-border px-3 py-2.5 text-left text-sm transition-colors hover:border-border-strong hover:bg-surface-hover"
              >
                <span className="mt-px shrink-0 text-xs font-semibold text-fg-subtle">{i + 1}</span>
                <span className="text-fg">{o.text}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );

  const summarySection = (
    <section>
      <h2 className="section-title">Website summary</h2>
      <p className="mt-0.5 text-xs text-fg-muted">A neutral, editable summary of the current site.</p>
      <div className="mt-1.5">
        <AutoSaveTextarea
          key={planning.id + (planning.analysed_at ?? "")}
          defaultValue={planning.website_summary ?? ""}
          onSave={handleSaveSummary}
          rows={4}
        />
      </div>
    </section>
  );

  const statusSection = (
    <section>
      <h2 className="section-title">Audit status</h2>
      <ul className="mt-2 divide-y divide-border rounded-md border border-border">
        {rows.map((row) => {
          const clickable = row.points.length > 0 || (row.key === "google_reviews" && Boolean(planning.review_intelligence));
          return (
            <li key={row.key}>
              <button
                type="button"
                onClick={() => selectRow(row)}
                disabled={!clickable}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left disabled:cursor-default"
              >
                <span className="text-sm text-fg">{row.label}</span>
                <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-fg-muted">
                  <span className={`h-1.5 w-1.5 rounded-full ${ROW_STATE_DOT[row.state]}`} aria-hidden="true" />
                  {ROW_STATE_LABEL[row.state]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={onOpenAuditTab}
        className="mt-2 text-xs font-medium text-fg-muted hover:text-fg hover:underline"
      >
        View evidence →
      </button>
    </section>
  );

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6">
      <div className="flex min-w-0 flex-col gap-6">
        <div className="order-1 lg:order-2">{summarySection}</div>
        <div className="order-2 lg:order-1">{opportunitiesSection}</div>
        <div className="order-3 lg:hidden">
          <EvidencePanel planning={planning} evidence={selected} />
        </div>
        <div className="order-4 lg:order-3">{statusSection}</div>
      </div>

      <aside className="mt-6 hidden space-y-4 lg:mt-0 lg:block lg:self-start">
        <EvidencePanel planning={planning} evidence={selected} />
        <NotesPreview notes={planning.operator_notes} onOpenNotes={onOpenNotesTab} />
      </aside>
    </div>
  );
}
