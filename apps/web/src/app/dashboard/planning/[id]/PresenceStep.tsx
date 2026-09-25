"use client";

import { api, type Lead, type Planning } from "@/lib/api";
import { AutoSaveTextarea } from "@/components/ui/AutoSaveTextarea";
import { Disclosure } from "@/components/ui/Disclosure";
import { planningMode } from "../lib";
import { AnalyseWebsiteAction } from "./AnalyseWebsiteAction";
import { AnalysingOverview } from "./AnalysingOverview";
import { AuditTab } from "./AuditTab";
import { GenerateWebsitePlanAction } from "./GenerateWebsitePlanAction";
import { ReviewInsightsTab } from "./ReviewInsightsTab";
import { StepFooter } from "./StepFooter";
import { WebsitePlanTab } from "./WebsitePlanTab";

type LeadContactFields = Pick<Lead, "business_phone" | "business_email">;

/**
 * Step 2 — "Review current presence": the website audit (or, in New
 * Website Plan mode, the generated plan standing in for it) and Google
 * Review Insights, composed as two clearly labelled subsections —
 * `AuditTab`/`WebsitePlanTab` and `ReviewInsightsTab` are reused
 * whole, not rebuilt. The branching for "nothing generated yet" /
 * "analysing" / "real content" mirrors the old OverviewTab's exact
 * conditions (see processSteps.ts's docstring) rather than a fresh
 * read of the same fields, so a failed audit or missing review text is
 * explained the same honest way it always was, never shown as a
 * completed analysis. Review Insights is deliberately independent of
 * the audit's own state — it stayed reachable on its own tab before,
 * so it stays reachable here even while the audit is mid-run.
 */
export function PresenceStep({
  planning,
  lead,
  onUpdated,
  onPrevious,
  onNext,
}: {
  planning: Planning;
  lead: LeadContactFields | null;
  onUpdated: (p: Planning) => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const hasAudit = planning.website_audit_id !== null;
  const mode = planningMode(planning);
  const isAnalysing = planning.status === "analysing";

  async function handleSaveSummary(value: string) {
    onUpdated(await api.updatePlanning(planning.id, { website_summary: value }));
  }

  let currentSiteContent;
  if (isAnalysing && !hasAudit) {
    currentSiteContent = <AnalysingOverview planning={planning} />;
  } else if (mode === "new") {
    if (planning.website_plan_generated_at === null) {
      currentSiteContent = planning.website_url ? (
        <AnalyseWebsiteAction planning={planning} onAnalysed={onUpdated} />
      ) : (
        <GenerateWebsitePlanAction planning={planning} onGenerated={onUpdated} />
      );
    } else {
      currentSiteContent = (
        <div className="space-y-5">
          <section>
            <h3 className="text-sm font-semibold text-fg">Website summary</h3>
            <p className="mt-0.5 text-xs text-fg-muted">A neutral, editable summary of the plan.</p>
            {/* Free-text prose reads better at a narrower measure than the
                full (now much wider) step column — a local constraint on
                just this block, not the whole workspace shell. */}
            <div className="mt-1.5 max-w-2xl">
              <AutoSaveTextarea
                key={planning.id + (planning.website_plan_generated_at ?? "")}
                defaultValue={planning.website_summary ?? ""}
                onSave={handleSaveSummary}
                rows={4}
              />
            </div>
          </section>
          <WebsitePlanTab planning={planning} lead={lead} onUpdated={onUpdated} />
        </div>
      );
    }
  } else {
    currentSiteContent = (
      <div className="space-y-5">
        {isAnalysing && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-surface-subtle px-3 py-2 text-xs text-fg-muted">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent motion-safe:animate-pulse" aria-hidden="true" />
            Re-analysing — the results below are from the previous run.
          </div>
        )}
        <section>
          <h3 className="text-sm font-semibold text-fg">Website summary</h3>
          <p className="mt-0.5 text-xs text-fg-muted">A neutral, editable summary of the current site.</p>
          {/* Same local width constraint as the New Website Plan mode's
              summary above — see that comment. */}
          <div className="mt-1.5 max-w-2xl">
            <AutoSaveTextarea
              key={planning.id + (planning.analysed_at ?? "")}
              defaultValue={planning.website_summary ?? ""}
              onSave={handleSaveSummary}
              rows={4}
            />
          </div>
        </section>
        <AuditTab planning={planning} />
      </div>
    );
  }

  return (
    <div className="content-reveal space-y-4">
      <p className="text-sm text-fg-muted">
        {mode === "existing"
          ? "Review the website audit and Google Review Insights before deciding what to improve."
          : "Review the generated website plan and Google Review Insights before deciding what to build."}
      </p>

      <Disclosure title={mode === "existing" ? "Website Audit" : "Website Plan"} defaultOpen>
        {currentSiteContent}
      </Disclosure>

      <Disclosure title="Google Review Insights" defaultOpen>
        <ReviewInsightsTab planning={planning} onUpdated={onUpdated} />
      </Disclosure>

      <StepFooter onPrevious={onPrevious} onNext={onNext} />
    </div>
  );
}
