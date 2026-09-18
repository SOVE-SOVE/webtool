"use client";

import { useEffect, useState } from "react";
import { TabBar, type TabItem } from "@/components/ui/Tabs";

export type BuildViewId = "planning" | "projects";

const LABEL: Record<BuildViewId, string> = { planning: "Planning", projects: "Projects" };
const DEFAULT_HREF: Record<BuildViewId, string> = {
  planning: "/dashboard/build/planning",
  projects: "/dashboard/build/projects",
};

/**
 * The same underline `TabBar` Clients uses for Overview/Websites/Revenue
 * (see `dashboard/clients/page.tsx`) — reused here, not reimplemented,
 * so typography, spacing, the active-tab indicator, hover/focus states,
 * and responsive overflow all stay identical across workspaces. The one
 * difference from Clients' own usage: this switches the actual view
 * (real navigation to a real URL, not a local/URL-param setter), so
 * each tab is built with an `href` rather than relying on `onChange` —
 * `TabBar` renders those as real `<Link>`s.
 *
 * Each link targets that view's own last-known URL (search/filters/
 * sort/pagination — the same string each view's list already writes to
 * `wdos-list-return:<view>` on every render) so switching away and back
 * restores where that view was left, not a blank slate. Read after
 * mount only (sessionStorage isn't available during SSR/first paint —
 * same convention as useDensity/useClientTab elsewhere in this app);
 * the bare route is a correct, harmless first-paint fallback since it's
 * still a valid, working link to that view.
 */
export function BuildSwitch({ active, className }: { active: BuildViewId; className?: string }) {
  const [hrefs, setHrefs] = useState<Record<BuildViewId, string>>(DEFAULT_HREF);

  // Re-read on every mount of this control (i.e. every time the user
  // lands on one of the two views) so the *other* view's link always
  // reflects its latest saved state, not a snapshot from first load —
  // same "read after mount" convention as useDensity/useClientTab.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHrefs({
      planning: sessionStorage.getItem("wdos-list-return:planning") || DEFAULT_HREF.planning,
      projects: sessionStorage.getItem("wdos-list-return:projects") || DEFAULT_HREF.projects,
    });
  }, [active]);

  const tabs: TabItem[] = (["planning", "projects"] as const).map((view) => ({
    id: view,
    label: LABEL[view],
    href: hrefs[view],
  }));

  return <TabBar tabs={tabs} active={active} ariaLabel="Build view" className={className} />;
}
