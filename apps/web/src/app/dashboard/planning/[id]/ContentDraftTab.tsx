"use client";

import { useState } from "react";
import { api, ApiError, type Planning } from "@/lib/api";
import { computeContentDraftReadiness } from "../lib";
import { ContentDraftPageCard } from "./ContentDraftPageCard";
import { ContentDraftProgress } from "./ContentDraftProgress";

/** Content Draft's main tab: readiness explainer, the "Generate Content
 * Draft" action, live progress while the job runs, and one card per
 * sitemap page that has generated content. Regeneration on an
 * already-approved/edited page never runs silently — see
 * ContentDraftPageCard/ContentSectionEditor's own docstrings. */
export function ContentDraftTab({ planning, onUpdated }: { planning: Planning; onUpdated: (p: Planning) => void }) {
  const readiness = computeContentDraftReadiness(planning);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isGenerating = planning.content_draft_status === "generating";
  const hasFailed = planning.content_draft_status === "needs_review" || planning.content_draft_status === "failed";

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      onUpdated(await api.generateContentDraft(planning.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start Content Draft generation.");
    } finally {
      setGenerating(false);
    }
  }

  const pagesWithContent = planning.content_pages.filter((p) => p.sections.length > 0);

  return (
    <div className="space-y-5">
      <div className="rounded-md border border-border bg-surface p-4">
        <p className="text-sm font-medium text-fg">What will be used</p>
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {readiness.items.map((item) => (
            <li key={item.label} className="flex items-center gap-1.5 text-xs">
              <span aria-hidden="true" className={item.available ? "text-emerald-600 dark:text-emerald-400" : "text-fg-subtle"}>
                {item.available ? "✓" : "—"}
              </span>
              <span className={item.available ? "text-fg" : "text-fg-subtle"}>{item.label}</span>
            </li>
          ))}
        </ul>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating || isGenerating || Boolean(readiness.blocker)}
            className="btn btn-primary btn-sm"
          >
            {isGenerating || generating
              ? "Generating…"
              : pagesWithContent.length > 0
                ? "Regenerate Content Draft"
                : "Generate Content Draft"}
          </button>
          {readiness.blocker && <p className="text-xs text-fg-subtle">{readiness.blocker}</p>}
        </div>

        {isGenerating && (
          <div className="mt-3">
            <ContentDraftProgress progressLabel={planning.content_draft_progress_label} />
          </div>
        )}

        {error && <p className="mt-2 text-error">{error}</p>}

        {!isGenerating && hasFailed && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-300">
            <span>{planning.content_draft_error || "Content Draft generation didn't finish."}</span>
            <button type="button" onClick={handleGenerate} className="font-medium underline">
              Retry
            </button>
          </div>
        )}
      </div>

      {pagesWithContent.length > 0 ? (
        <div className="space-y-3">
          {pagesWithContent.map((page) => (
            <ContentDraftPageCard
              key={page.id}
              planningId={planning.id}
              page={page}
              sitemapPage={planning.sitemap_pages.find((sp) => sp.id === page.sitemap_page_id)}
              onUpdated={onUpdated}
            />
          ))}
        </div>
      ) : (
        !isGenerating && <p className="text-xs text-fg-subtle">No content drafted yet.</p>
      )}
    </div>
  );
}
