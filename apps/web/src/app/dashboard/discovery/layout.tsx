"use client";

import { useEffect, useState } from "react";
import { usePathname, useParams } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { DiscoveryWorkspace } from "@/components/DiscoveryWorkspace";
import { ReviewQueueWorkspace } from "@/components/ReviewQueueWorkspace";
import { DiscoverySwitch, type DiscoveryViewId } from "./DiscoverySwitch";
import { setLastDiscoveryView } from "./lastView";

function viewFromPathname(pathname: string): DiscoveryViewId {
  return pathname.startsWith("/dashboard/discovery/review") ? "review" : "map";
}

/**
 * The one shared "Discovery" header for both merged views (Map
 * Discovery / Review Queue) — rendered exactly once here, same pattern
 * as Sales'/Build's own layout. Each view keeps its own contextual
 * controls beneath this (search form, filters, "Import from Instagram"
 * for Map; metrics, sub-tabs, bulk actions for Review) — "one header"
 * doesn't mean "one toolbar".
 *
 * The key difference from Sales/Build: **both views stay mounted at all
 * times**, toggled with a plain `hidden` attribute instead of Next.js
 * unmounting the inactive route's page component. Three reasons this
 * one workspace needs that where Sales/Build didn't:
 *  1. Map Discovery owns a Leaflet map instance (`DiscoveryMap`) that's
 *     expensive to tear down and recreate, and loses pan/zoom/selection
 *     on remount.
 *  2. "Switching back to Map Discovery must not rerun a paid search" —
 *     the search itself is never re-triggered on mount (only explicit
 *     Run search/Load more calls the paid provider), but neither view
 *     had any URL-synced filter/sort/scroll state before this merge, so
 *     a real unmount would lose it. Keeping both mounted preserves
 *     every bit of it for free (including native scroll position of
 *     the hidden view) instead of re-implementing per-field
 *     sessionStorage restoration for two pages that never needed it
 *     before.
 *  3. Review Queue's own background poll (research/audit/score
 *     progress) and Map Discovery's website-check poll both keep
 *     running invisibly while the other tab is open, so switching back
 *     shows current state immediately rather than a re-fetch flash.
 *
 * Both routes still exist and are real, bookmarkable URLs
 * (`/dashboard/discovery/map[/​{searchId}]`, `/dashboard/discovery/
 * review`) — `usePathname()`/`useParams()` just decide which mounted
 * subtree is visible, so browser Back/Forward and direct links all
 * work exactly as they would if these were two separate pages. Because
 * the two child `page.tsx` files render nothing of their own (this
 * layout owns all the content), `children` is intentionally unused.
 */
export default function DiscoveryLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useParams<{ id?: string }>();
  const active = viewFromPathname(pathname);
  const [reviewCount, setReviewCount] = useState<number | undefined>(undefined);
  const [reviewRefreshToken, setReviewRefreshToken] = useState(0);

  useEffect(() => {
    setLastDiscoveryView(active);
  }, [active]);

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Discovery"
        description={
          active === "review"
            ? "Choose which businesses to pursue."
            : "Find businesses that might be a good fit for a website redesign, then review and bring the best ones into the CRM."
        }
      />
      <DiscoverySwitch active={active} reviewCount={reviewCount} className="mt-4" />
      <div className="mt-6">
        <div hidden={active !== "map"}>
          <DiscoveryWorkspace
            initialSearchId={params.id}
            mapVisible={active === "map"}
            onQueueChanged={() => setReviewRefreshToken((t) => t + 1)}
          />
        </div>
        <div hidden={active !== "review"}>
          <ReviewQueueWorkspace refreshToken={reviewRefreshToken} onActionableCountChange={setReviewCount} />
        </div>
      </div>
      {children}
    </div>
  );
}
