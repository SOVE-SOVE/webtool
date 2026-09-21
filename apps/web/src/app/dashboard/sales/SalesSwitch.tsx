"use client";

import { useEffect, useState } from "react";
import { TabBar, type TabItem } from "@/components/ui/Tabs";

export type SalesViewId = "leads" | "pipeline" | "follow-ups";

const LABEL: Record<SalesViewId, string> = { leads: "Leads", pipeline: "Sales Pipeline", "follow-ups": "Follow-ups" };
const DEFAULT_HREF: Record<SalesViewId, string> = {
  leads: "/dashboard/sales/leads",
  pipeline: "/dashboard/sales/pipeline",
  "follow-ups": "/dashboard/sales/follow-ups",
};

/**
 * The same underline `TabBar` Clients uses for Overview/Websites/Revenue
 * (see `dashboard/clients/page.tsx`), and the same one Build's own
 * `BuildSwitch` now uses — reused here, not reimplemented, so
 * typography, spacing, the active-tab indicator, hover/focus states,
 * and responsive overflow all stay identical across workspaces. This
 * switches the actual view (real navigation to a real URL, not a
 * local/URL-param setter), so each tab is built with an `href` rather
 * than relying on `onChange` — `TabBar` renders those as real `<Link>`s.
 *
 * Each link targets that view's own last-known URL (search/filters/
 * sort/pagination — the same string each view's list already writes to
 * `wdos-list-return:<view>` on every render) so switching away and back
 * restores where that view was left, not a blank slate. Read after
 * mount only (sessionStorage isn't available during SSR/first paint —
 * same convention as useDensity/useClientTab elsewhere in this app);
 * the bare route is a correct, harmless first-paint fallback since it's
 * still a valid, working link to that view — and the only fallback
 * Sales Pipeline/Follow-ups will ever have, since neither writes any
 * `wdos-list-return:*` key of its own (they have no URL-driven filter
 * state to persist in the first place).
 */
export function SalesSwitch({ active, className }: { active: SalesViewId; className?: string }) {
  const [hrefs, setHrefs] = useState<Record<SalesViewId, string>>(DEFAULT_HREF);

  // Re-read on every mount of this control (i.e. every time the user
  // lands on one of the three views) so the *other* views' links always
  // reflect their latest saved state, not a snapshot from first load —
  // same "read after mount" convention as useDensity/useClientTab.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHrefs({
      leads: sessionStorage.getItem("wdos-list-return:leads") || DEFAULT_HREF.leads,
      pipeline: sessionStorage.getItem("wdos-list-return:pipeline") || DEFAULT_HREF.pipeline,
      "follow-ups": sessionStorage.getItem("wdos-list-return:follow-ups") || DEFAULT_HREF["follow-ups"],
    });
  }, [active]);

  const tabs: TabItem[] = (["leads", "pipeline", "follow-ups"] as const).map((view) => ({
    id: view,
    label: LABEL[view],
    href: hrefs[view],
  }));

  return <TabBar tabs={tabs} active={active} ariaLabel="Sales view" variant="workspace" className={className} />;
}
