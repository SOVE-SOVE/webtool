"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type AttentionItem } from "@/lib/api";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * The workspace-wide "what should I do next" queue, pinned to the bottom
 * of every dashboard page. The list is server-ranked (most urgent
 * first) by the API; this component just renders it in a fixed-height,
 * internally scrolling card so a long queue never stretches the page.
 *
 * Data source: GET /api/v1/dashboard/overview → `needs_attention`
 * (the same call the Overview page makes). Cached module-side for a
 * short window so navigating between pages doesn't re-hit the (fairly
 * heavy) aggregate query on every click, but a genuine revisit after
 * doing work elsewhere still refreshes it.
 */

// One place for the attention-kind → badge colour mapping that the
// Overview and Sales pages each used to define separately. Colour
// reinforces the server ranking: something broken/hot is warm-coloured,
// routine hygiene is neutral.
const BADGE_CLASS: Record<AttentionItem["kind"], string> = {
  project: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
  stale_proposal: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
  follow_up: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  meeting: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  hot_lead: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300",
  task: "bg-surface-subtle text-fg-muted",
  stale_lead: "bg-surface-subtle text-fg-muted",
  new_lead: "bg-surface-subtle text-fg-muted",
};

const FRESH_MS = 20_000;
let cache: { at: number; items: AttentionItem[] } | null = null;
let inflight: Promise<AttentionItem[]> | null = null;

function loadAttention(): Promise<AttentionItem[]> {
  if (cache && Date.now() - cache.at < FRESH_MS) return Promise.resolve(cache.items);
  if (inflight) return inflight;
  inflight = api
    .dashboardOverview()
    .then((d) => {
      cache = { at: Date.now(), items: d.needs_attention };
      return d.needs_attention;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Called after a mutation elsewhere so the next render refetches. */
export function invalidateAttention() {
  cache = null;
}

export function DoThisNext() {
  const pathname = usePathname();
  const [items, setItems] = useState<AttentionItem[] | null>(cache?.items ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    loadAttention()
      .then((next) => {
        if (!alive) return;
        setItems(next);
        setFailed(false);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [pathname]);

  // A page-level error surface for this is more noise than signal on
  // every screen — if the queue can't load, just don't take up space.
  if (failed && items === null) return null;

  const count = items?.length ?? 0;

  return (
    <section className="border-t border-border bg-canvas px-4 py-5 sm:px-6">
      <div className="w-full">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="section-title">Do this next</h2>
          <span className="text-xs text-fg-muted">
            {items === null ? "Loading…" : count === 0 ? "All clear" : `${count} open · most urgent first`}
          </span>
        </div>

        <div className="mt-2 max-h-56 overflow-y-auto overscroll-contain rounded-md border border-border bg-surface sm:max-h-72">
          {items === null ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-4 px-4 py-3">
                  <Skeleton className="h-3 w-2/5" />
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </div>
          ) : count === 0 ? (
            <p className="px-4 py-6 text-sm text-fg-muted">
              Nothing is waiting on you. Add leads, or push an active project forward.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((item) => (
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
                    <span
                      className={`mt-0.5 shrink-0 rounded px-2 py-0.5 text-xs font-medium ${BADGE_CLASS[item.kind]}`}
                    >
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
