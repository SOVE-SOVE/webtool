"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { TabBar, type TabItem } from "@/components/ui/Tabs";
import { useClientsTab, type ClientsTabId } from "./useClientsTab";
import { ClientsOverviewTab } from "./ClientsOverviewTab";
import { ClientsWebsitesTab } from "./ClientsWebsitesTab";
import { ClientsRevenueTab } from "./ClientsRevenueTab";

const CLIENTS_TABS: TabItem[] = [
  { id: "overview", label: "Overview" },
  { id: "websites", label: "Websites" },
  { id: "revenue", label: "Revenue" },
];

/**
 * The Clients workspace — one destination for client relationships,
 * live websites, hosting, and payments (previously three separate
 * sidebar entries: Clients, Live Websites, Revenue — see
 * docs/07_SESSION_LOG.md). Each tab owns its own data fetch and
 * tab-specific primary action (Add Client / — / Record Payment) rather
 * than this shell hoisting a one-size-fits-all action bar; only the
 * title and tab strip are shared.
 */
function ClientsPageInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeTab, setTab } = useClientsTab();
  const [currency, setCurrency] = useState("AUD");

  useEffect(() => {
    api.getWorkspace().then((w) => setCurrency(w.currency)).catch(() => {});
  }, []);

  // Written on every tab/filter change so "← Clients" from an
  // individual Client's detail page returns to exactly where the
  // operator left off — same key/mechanism the old flat Clients list
  // page used, just captured once at the workspace shell level now
  // that Overview is only one of three tabs sharing this route.
  useEffect(() => {
    sessionStorage.setItem("wdos-list-return:clients", `${pathname}?${searchParams.toString()}`);
  }, [pathname, searchParams]);

  return (
    <div className="p-4 sm:p-6">
      {/* No description line here — the tab strip below already says what
          each tab is, and each tab's own summary/filters row explains
          itself; an introductory sentence on top of both was redundant. */}
      <PageHeader title="Clients" />

      <TabBar tabs={CLIENTS_TABS} active={activeTab} onChange={(id) => setTab(id as ClientsTabId)} variant="workspace" className="mt-4" />

      <div key={activeTab} className="animate-fade-in mt-6">
        {activeTab === "overview" && <ClientsOverviewTab currency={currency} />}
        {activeTab === "websites" && <ClientsWebsitesTab currency={currency} />}
        {activeTab === "revenue" && <ClientsRevenueTab />}
      </div>
    </div>
  );
}

export default function ClientsPage() {
  return (
    <Suspense fallback={<div className="p-4 sm:p-6" />}>
      <ClientsPageInner />
    </Suspense>
  );
}
