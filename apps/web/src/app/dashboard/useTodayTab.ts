"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { withParam } from "@/lib/url";

const TAB_IDS = ["overview", "tasks", "calendar"] as const;
export type TodayTabId = (typeof TAB_IDS)[number];

function isValidTab(v: string | null): v is TodayTabId {
  return (TAB_IDS as readonly string[]).includes(v ?? "");
}

/**
 * URL-synced top-level tab state for the Today workspace (Overview /
 * Tasks / Calendar) — same `tab` param and `withParam` mechanism as
 * `useClientsTab.ts`, except a tab switch is a history *push*, not a
 * replace: Back/Forward step through the tabs you visited (Clients
 * replaces, so Back there leaves the page). The active tab is derived
 * from the URL on every render, so Back/Forward needs no extra
 * handling here. No localStorage fallback, matching
 * that precedent: a bare `/dashboard` always opens on Overview, exactly
 * the page it already showed before this merge.
 */
export function useTodayTab(): { activeTab: TodayTabId; setTab: (id: TodayTabId) => void } {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab = isValidTab(tabParam) ? tabParam : "overview";

  function setTab(id: TodayTabId) {
    router.push(`${pathname}?${withParam(searchParams, "tab", id === "overview" ? null : id)}`, { scroll: false });
  }

  return { activeTab, setTab };
}
