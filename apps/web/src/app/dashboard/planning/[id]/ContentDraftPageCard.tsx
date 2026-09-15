"use client";

import { useState } from "react";
import { api, ApiError, CONTENT_PAGE_STATUS_LABELS, type ContentPage, type Planning, type SitemapPageProposal } from "@/lib/api";
import { Disclosure } from "@/components/ui/Disclosure";
import { AutoSaveInput } from "@/components/ui/AutoSaveInput";
import { AutoSaveTextarea } from "@/components/ui/AutoSaveTextarea";
import { ContentSectionEditor } from "./ContentSectionEditor";

const STATUS_BADGE: Record<ContentPage["status"], string> = {
  draft: "bg-surface-subtle text-fg-muted",
  edited: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
};

/** One card per sitemap page that has generated content. Approving is
 * disabled until every section carries some real content, matching the
 * "no placeholders in build-ready copy" rule — this is a shallow
 * client-side nudge, not a substitute for the backend's own rules. */
export function ContentDraftPageCard({
  planningId,
  page,
  sitemapPage,
  onUpdated,
}: {
  planningId: string;
  page: ContentPage;
  sitemapPage: SitemapPageProposal | undefined;
  onUpdated: (p: Planning) => void;
}) {
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasEmptySection = page.sections.some((s) => Object.keys(s.content).length === 0);
  const canApprove = page.sections.length > 0 && !hasEmptySection && page.status !== "approved";

  async function handleApprove() {
    setApproving(true);
    setError(null);
    try {
      onUpdated(await api.approveContentPage(planningId, page.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't approve this page.");
    } finally {
      setApproving(false);
    }
  }

  return (
    <Disclosure
      title={sitemapPage?.title ?? "Page"}
      hint={`${page.sections.length} section${page.sections.length === 1 ? "" : "s"}`}
      badge={
        <span className="flex items-center gap-1.5">
          {page.stale && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
              Needs review — source changed
            </span>
          )}
          <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_BADGE[page.status]}`}>
            {CONTENT_PAGE_STATUS_LABELS[page.status]}
          </span>
        </span>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">SEO page title</p>
            <AutoSaveInput
              key={page.seo_title ?? ""}
              defaultValue={page.seo_title ?? ""}
              placeholder="Proposed SEO title"
              onSave={(value) =>
                api
                  .updateContentPageSeo(planningId, page.id, { seo_title: value || null, seo_meta_description: page.seo_meta_description })
                  .then(onUpdated)
              }
            />
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">SEO meta description</p>
            <AutoSaveTextarea
              key={page.seo_meta_description ?? ""}
              defaultValue={page.seo_meta_description ?? ""}
              rows={2}
              placeholder="Proposed meta description"
              onSave={(value) =>
                api
                  .updateContentPageSeo(planningId, page.id, { seo_title: page.seo_title, seo_meta_description: value || null })
                  .then(onUpdated)
              }
            />
          </div>
        </div>

        <div className="space-y-3">
          {page.sections.map((section) => (
            <ContentSectionEditor
              key={section.id}
              planningId={planningId}
              pageId={page.id}
              section={section}
              pageApproved={page.status === "approved"}
              onUpdated={onUpdated}
            />
          ))}
        </div>

        {error && <p className="text-error">{error}</p>}

        <div className="flex items-center gap-2 border-t border-border pt-3">
          <button type="button" onClick={handleApprove} disabled={!canApprove || approving} className="btn btn-primary btn-sm">
            {approving ? "Approving…" : page.status === "approved" ? "Approved" : "Approve page"}
          </button>
          {hasEmptySection && page.status !== "approved" && (
            <p className="text-xs text-fg-subtle">Every section needs content before this page can be approved.</p>
          )}
        </div>
      </div>
    </Disclosure>
  );
}
