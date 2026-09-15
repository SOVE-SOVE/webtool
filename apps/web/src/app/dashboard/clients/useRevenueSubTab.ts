"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { withParam } from "@/lib/url";

const TAB_IDS = ["payments", "upcoming", "hosting"] as const;
export type RevenueSubTabId = (typeof TAB_IDS)[number];

function isValidTab(v: string | null): v is RevenueSubTabId {
  return (TAB_IDS as readonly string[]).includes(v ?? "");
}

/**
 * URL-synced sub-tab state for the Clients workspace's Revenue tab —
 * deliberately its own `revenueTab` param, distinct from the outer
 * Clients workspace's own `tab` param (overview/websites/revenue), so
 * the two tab levels never collide or clobber each other in the URL.
 * No localStorage fallback (unlike the Client detail page's
 * useClientTab): every filter here already lives in the URL too, so
 * landing on the Revenue tab always opens on Payments by default rather
 * than silently reopening wherever a past visit left off.
 */
export function useRevenueSubTab(): { activeTab: RevenueSubTabId; setTab: (id: RevenueSubTabId) => void } {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("revenueTab");
  const activeTab = isValidTab(tabParam) ? tabParam : "payments";

  function setTab(id: RevenueSubTabId) {
    router.replace(`${pathname}?${withParam(searchParams, "revenueTab", id === "payments" ? null : id)}`, {
      scroll: false,
    });
  }

  return { activeTab, setTab };
}
