"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { withParam } from "@/lib/url";

const TAB_IDS = ["overview", "projects", "billing", "tasks", "details"] as const;
export type ClientTabId = (typeof TAB_IDS)[number];

function isValidTab(v: string | null): v is ClientTabId {
  return (TAB_IDS as readonly string[]).includes(v ?? "");
}

/**
 * The client detail page's tab, remembered per client. The URL's `?tab=`
 * always wins when present (so a shared/bookmarked link opens on the
 * right tab regardless of what's remembered); with no `?tab=` at all,
 * a remembered tab (if any) is applied via a mount effect — same "read
 * after mount, not a lazy initializer" convention as useDensity.ts, to
 * avoid an SSR/hydration mismatch. This costs one extra render on a
 * cold load when a non-overview tab was last used; useDensity accepts
 * the identical tradeoff for the same reason.
 */
export function useClientTab(clientId: string): { activeTab: ClientTabId; setTab: (id: ClientTabId) => void } {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const urlTab = isValidTab(tabParam) ? tabParam : null;

  const [rememberedTab, setRememberedTab] = useState<ClientTabId | null>(null);

  useEffect(() => {
    if (urlTab) return;
    const stored = localStorage.getItem(`wdos-client-tab:${clientId}`);
    if (stored && isValidTab(stored) && stored !== "overview") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRememberedTab(stored);
      router.replace(`${pathname}?${withParam(searchParams, "tab", stored)}`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  function setTab(id: ClientTabId) {
    localStorage.setItem(`wdos-client-tab:${clientId}`, id);
    setRememberedTab(id);
    router.replace(`${pathname}?${withParam(searchParams, "tab", id === "overview" ? null : id)}`, { scroll: false });
  }

  return { activeTab: urlTab ?? rememberedTab ?? "overview", setTab };
}

export const CLIENT_TABS: { id: ClientTabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "projects", label: "Projects & Websites" },
  { id: "billing", label: "Billing" },
  { id: "tasks", label: "Tasks" },
  { id: "details", label: "Details & Notes" },
];
