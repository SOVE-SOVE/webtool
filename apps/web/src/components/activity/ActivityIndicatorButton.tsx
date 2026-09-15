"use client";

import { useEffect, useState } from "react";
import type { PlanningListItem } from "@/lib/api";
import { CountBadge } from "@/components/ui/CountBadge";
import { loadNavCounts, peekPlanningItems } from "@/lib/navCounts";
import { ActivityPanel } from "./ActivityPanel";

function isRunning(item: PlanningListItem): boolean {
  return (
    item.status === "analysing" ||
    item.comparable_research_status === "analysing" ||
    item.content_draft_status === "generating"
  );
}

/**
 * Desktop-header entry point for the background activity panel — quiet
 * (just an icon) when nothing is running, a small pulsing dot + count
 * when something is. Reads the shared navCounts cache (already
 * fetching listPlanning() on every navigation) rather than polling
 * independently; only polls (10s, while the panel is open) to show
 * real progress without adding a standing background interval.
 */
export function ActivityIndicatorButton() {
  const [items, setItems] = useState<PlanningListItem[] | null>(() => peekPlanningItems());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    loadNavCounts().then(() => setItems(peekPlanningItems()));
  }, []);

  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => {
      loadNavCounts({ force: true }).then(() => setItems(peekPlanningItems()));
    }, 10_000);
    return () => clearInterval(id);
  }, [open]);

  const running = (items ?? []).filter(isRunning);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={running.length > 0 ? `Background activity — ${running.length} running` : "Background activity"}
        title={running.length > 0 ? `Background activity — ${running.length} running` : "Background activity"}
        className="relative flex items-center gap-1 rounded-md p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg"
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <circle cx="10" cy="10" r="7" />
          <path d="M10 6.5v4l2.5 1.5" />
        </svg>
        {running.length > 0 && (
          <>
            <span
              className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent motion-safe:animate-pulse"
              aria-hidden="true"
            />
            <CountBadge count={running.length} className="ml-0" />
          </>
        )}
      </button>
      {open && <ActivityPanel items={items ?? []} onClose={() => setOpen(false)} />}
    </>
  );
}
