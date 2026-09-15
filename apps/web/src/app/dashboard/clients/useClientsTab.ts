"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { withParam } from "@/lib/url";

const TAB_IDS = ["overview", "websites", "revenue"] as const;
export type ClientsTabId = (typeof TAB_IDS)[number];

function isValidTab(v: string | null): v is ClientsTabId {
  return (TAB_IDS as readonly string[]).includes(v ?? "");
}

/**
 * URL-synced top-level tab state for the Clients workspace
 * (Overview/Websites/Revenue) — deliberately the `tab` param, one level
 * above the Revenue tab's own `revenueTab` param for its
 * Payments/Upcoming & Overdue/Hosting Plans sub-tabs, so the two never
 * collide in the URL. No localStorage fallback (every filter here
 * already lives in the URL too, matching Revenue's own precedent): a
 * bare `/dashboard/clients` always opens on Overview.
 */
export function useClientsTab(): { activeTab: ClientsTabId; setTab: (id: ClientsTabId) => void } {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab = isValidTab(tabParam) ? tabParam : "overview";

  function setTab(id: ClientsTabId) {
    router.replace(`${pathname}?${withParam(searchParams, "tab", id === "overview" ? null : id)}`, { scroll: false });
  }

  return { activeTab, setTab };
}
