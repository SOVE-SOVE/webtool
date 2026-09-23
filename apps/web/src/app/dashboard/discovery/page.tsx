"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { DelayedSectionLoading } from "@/components/ui/SectionLoadingIndicator";
import { getLastDiscoveryView } from "./lastView";

/**
 * A bare /dashboard/discovery visit (no explicit view — the sidebar's
 * Discovery link points here) picks up wherever the operator left off:
 * the last view they were on, restored to that view's own last-known URL
 * (Map Discovery's specific search, via `wdos-list-return:discovery-map`
 * — see `DiscoverySwitch`), or that view's bare route if nothing's been
 * saved yet. An explicit link to `/dashboard/discovery/map` or
 * `/dashboard/discovery/review` always opens exactly that view — this
 * redirect only fires on the bare path. Exact mirror of
 * `dashboard/sales/page.tsx`'s/`dashboard/build/page.tsx`'s own
 * redirect, for the same reason.
 *
 * This bare path used to render the single Discovery workspace (map +
 * results together) directly — that content moved to `/dashboard/
 * discovery/map`, with Review Queue split out to its own `/dashboard/
 * discovery/review` tab (see docs/07_SESSION_LOG.md); this URL is now
 * purely the workspace's own entry point, same role `/dashboard/sales`
 * and `/dashboard/build` already have.
 */
function DiscoveryRedirectInner() {
  const router = useRouter();

  useEffect(() => {
    const view = getLastDiscoveryView();
    const saved = view === "map" ? sessionStorage.getItem("wdos-list-return:discovery-map") : null;
    router.replace(saved || `/dashboard/discovery/${view}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <DelayedSectionLoading icon="discovery" label="Loading Discovery…" />;
}

export default function DiscoveryRedirect() {
  return (
    <Suspense fallback={<DelayedSectionLoading icon="discovery" label="Loading Discovery…" />}>
      <DiscoveryRedirectInner />
    </Suspense>
  );
}
