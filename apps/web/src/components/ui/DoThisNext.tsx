"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AttentionItem } from "@/lib/api";
import { loadOverview, peekOverview } from "@/lib/overview";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * "What should I do next" for the project currently being planned — the
 * single most useful next action the server computed for it (one gate
 * at a time: brief, creative direction, sitemap, build, deploy — see
 * apps/api/app/modules/dashboard/service.py's `_next_project_action`),
 * pinned to the bottom of the Planning page.
 *
 * Data source: GET /api/v1/dashboard/overview → `needs_attention`,
 * filtered down to the single `kind: "project"` item matching
 * `projectId`, via the shared short-lived cache in lib/overview (so
 * this and the Today page's own overview fetch share one request
 * instead of two).
 */

// Every item this component can show is kind "project" (the filter
// below guarantees it) — one badge colour, not the full kind→colour map
// the workspace-wide queue used to need.
const PROJECT_BADGE_CLASS = "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300";

/**
 * Renders nothing when `projectId` is null — no project is in context
 * yet (e.g. a Planning item that hasn't been transferred to a Project).
 */
export function DoThisNext({ projectId }: { projectId: string | null }) {
  const [items, setItems] = useState<AttentionItem[] | null>(peekOverview()?.needs_attention ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    loadOverview()
      .then((d) => {
        if (!alive) return;
        setItems(d.needs_attention);
        setFailed(false);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [projectId]);

  if (!projectId) return null;
  // A page-level error surface for this is more noise than signal — if
  // the queue can't load, just don't take up space.
  if (failed && items === null) return null;

  const scoped = items?.filter((item) => item.kind === "project" && item.id === projectId) ?? null;
  const count = scoped?.length ?? 0;

  return (
    <section className="border-t border-border bg-canvas px-4 py-5 sm:px-6">
      <div className="w-full">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="section-title">Do this next</h2>
          <span className="text-xs text-fg-muted">
            {scoped === null ? "Loading…" : count === 0 ? "All clear" : `${count} open · most urgent first`}
          </span>
        </div>

        <div className="mt-2 max-h-56 overflow-y-auto overscroll-contain rounded-md border border-border bg-surface sm:max-h-72">
          {scoped === null ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-4 px-4 py-3">
                  <Skeleton className="h-3 w-2/5" />
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </div>
          ) : count === 0 ? (
            <p className="px-4 py-6 text-sm text-fg-muted">Nothing is waiting on you for this project right now.</p>
          ) : (
            <ul className="divide-y divide-border">
              {scoped.map((item) => (
                <li key={`${item.kind}-${item.id}`}>
                  <Link
                    href={item.href}
                    className="flex items-start justify-between gap-4 px-4 py-2.5 hover:bg-surface-hover"
                  >
                    <span className="min-w-0">
                      <span className="text-sm font-medium text-fg">{item.action}</span>
                      <span className="mt-0.5 block truncate text-xs text-fg-muted">
                        {item.title} — {item.detail}
                      </span>
                    </span>
                    <span className={`mt-0.5 shrink-0 rounded px-2 py-0.5 text-xs font-medium ${PROJECT_BADGE_CLASS}`}>
                      {item.label}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
