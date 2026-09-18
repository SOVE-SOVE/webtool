"use client";

import { useEffect, useState } from "react";
import { TabBar, type TabItem } from "@/components/ui/Tabs";

export type DiscoveryViewId = "map" | "review";

const DEFAULT_HREF: Record<DiscoveryViewId, string> = {
  map: "/dashboard/discovery/map",
  review: "/dashboard/discovery/review",
};

/**
 * The same underline `TabBar` Clients/Sales/Build all use — reused here,
 * not reimplemented, so typography, spacing, the active-tab indicator,
 * hover/focus states, and responsive overflow stay identical across
 * every workspace. Real navigation via `href` (not `onChange`), so each
 * tab is a stable, bookmarkable, Back/Forward-friendly URL.
 *
 * Unlike Sales/Build, the two views here don't unmount on tab switch —
 * `DiscoveryLayout` keeps both `DiscoveryWorkspace` and
 * `ReviewQueueWorkspace` mounted permanently (see its own docstring for
 * why: an expensive-to-recreate Leaflet map, and "switching tabs must
 * never re-run a paid search"). The Map tab's href still points at the
 * *specific search* last shown (mirroring Sales/Build's own
 * `wdos-list-return:*` convention) purely so the URL bar/bookmarks/
 * Back-Forward stay accurate — the content itself never needs to
 * refetch to restore it, since it was never torn down.
 */
export function DiscoverySwitch({
  active,
  reviewCount,
  className,
}: {
  active: DiscoveryViewId;
  reviewCount?: number;
  className?: string;
}) {
  const [mapHref, setMapHref] = useState(DEFAULT_HREF.map);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMapHref(sessionStorage.getItem("wdos-list-return:discovery-map") || DEFAULT_HREF.map);
  }, [active]);

  const tabs: TabItem[] = [
    { id: "map", label: "Map Discovery", href: mapHref },
    { id: "review", label: "Review Queue", href: DEFAULT_HREF.review, count: reviewCount },
  ];

  return <TabBar tabs={tabs} active={active} ariaLabel="Discovery view" className={className} />;
}
