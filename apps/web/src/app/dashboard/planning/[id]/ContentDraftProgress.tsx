"use client";

/**
 * "Generate Content Draft" progress — driven by a live, real
 * `content_draft_progress_label` string (e.g. "Drafting Services (2 of
 * 5)") the backend sets once per page as it works through the sitemap.
 * No fixed step list here (unlike AnalysingProgress.tsx): the number of
 * pages varies per plan, so a free-text label is the honest signal
 * rather than a simulated percentage.
 */
export function ContentDraftProgress({ progressLabel }: { progressLabel: string | null }) {
  return (
    <div className="flex items-center gap-2.5 text-sm" role="status" aria-live="polite">
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-fg motion-reduce:animate-none"
      />
      <span className="text-fg">{progressLabel ?? "Queued — this starts automatically."}</span>
    </div>
  );
}
