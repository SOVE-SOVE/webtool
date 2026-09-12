"use client";

import type { Planning } from "@/lib/api";
import { Skeleton } from "@/components/ui/Skeleton";
import { AnalysingProgress } from "./AnalysingProgress";
import { AnalysingPreviewPanel } from "./SidePanels";

/**
 * The Overview tab's content while status === "analysing" — same
 * two-column shape as the finished OverviewTab (so the transition into
 * the real thing is a content swap, not a layout jump), with the
 * progress list up top and skeleton placeholders standing in for
 * Top Opportunities, the Website Summary, and Audit status. Nothing
 * here is faked data — it's structure only, until the real content
 * replaces it in place.
 */
export function AnalysingOverview({ planning }: { planning: Planning }) {
  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6">
      <div className="flex min-w-0 flex-col gap-6">
        <section>
          <h2 className="section-title">Analysing this website</h2>
          <p className="mt-0.5 text-sm text-fg-muted">This page updates automatically as each step finishes.</p>
          <AnalysingProgress currentStep={planning.current_step} />
        </section>

        <section aria-hidden="true">
          <h2 className="section-title text-fg-subtle">Top opportunities</h2>
          <div className="mt-2 space-y-1.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2.5">
                <Skeleton className="h-3 w-4 shrink-0" />
                <Skeleton className={`h-3 ${i === 1 ? "w-2/3" : "w-4/5"}`} />
              </div>
            ))}
          </div>
        </section>

        <section aria-hidden="true">
          <h2 className="section-title text-fg-subtle">Website summary</h2>
          <div className="mt-1.5 space-y-2 rounded-md border border-border-strong p-3">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </section>

        <div className="lg:hidden" aria-hidden="true">
          <AnalysingPreviewPanel />
        </div>

        <section aria-hidden="true">
          <h2 className="section-title text-fg-subtle">Audit status</h2>
          <div className="mt-2 divide-y divide-border rounded-md border border-border">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-3 w-12" />
              </div>
            ))}
          </div>
        </section>
      </div>

      <aside className="mt-6 hidden space-y-4 lg:mt-0 lg:block" aria-hidden="true">
        <AnalysingPreviewPanel />
      </aside>
    </div>
  );
}
