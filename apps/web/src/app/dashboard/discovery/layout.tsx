"use client";

import { useEffect, useRef, useState } from "react";
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
  const [importOpen, setImportOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  // On the Map view the header/tabs (plus the Import button) float over
  // the top of Map Discovery's full-viewport map; Review Queue keeps the
  // ordinary in-flow header.
  const floating = active === "map";

  useEffect(() => {
    setLastDiscoveryView(active);
  }, [active]);

  // Publish the floating layer's height as `--discovery-layer-h` on the
  // layout root so the search panel (a fixed element inside
  // DiscoveryWorkspace, which inherits it) can sit just below the layer
  // however tall the layer is at the current width — no hard-coded
  // offset to drift out of sync.
  useEffect(() => {
    const root = rootRef.current;
    const layer = layerRef.current;
    if (!floating || !root || !layer) return;
    const publish = () => root.style.setProperty("--discovery-layer-h", `${layer.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(layer);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--discovery-layer-h");
    };
  }, [floating]);

  return (
    <div ref={rootRef} className="p-4 sm:p-6">
      {/* Above the map either way (z-20 floating / z-10 in flow): the
          fixed map (DiscoveryMap) would otherwise paint over these
          non-positioned elements. Floating, the layer itself ignores
          pointer events so the map stays draggable around the header
          card and Import button, which opt back in. Offsets mirror
          dashboard/layout.tsx's chrome, same as DiscoveryMap's — `left`
          reads the shared `--sidebar-w` variable so it stays flush with
          the sidebar's real edge in both collapsed and expanded states. */}
      <div
        ref={layerRef}
        className={
          floating
            ? "pointer-events-none fixed inset-x-0 top-12 z-20 flex items-start justify-between gap-3 p-3 lg:left-[var(--sidebar-w)] lg:top-11"
            : "relative z-10"
        }
      >
        {/* Floating, this is a slim bar: a compact "Discovery" label (from
            `sm` up — the tabs alone carry it on phones) beside the tabs.
            DiscoverySwitch stays in the same slot in both modes so it
            isn't remounted (and its sliding underline reset) on a tab
            switch; its own bottom border is made transparent in the bar
            so it doesn't double up with the bar's border. */}
        <div
          className={
            floating
              ? "pointer-events-auto flex min-w-0 items-center gap-4 map-glass px-4"
              : undefined
          }
        >
          {floating ? (
            <h1 className="hidden shrink-0 text-sm font-semibold text-fg sm:block">Discovery</h1>
          ) : (
            <PageHeader title="Discovery" />
          )}
          <DiscoverySwitch
            active={active}
            reviewCount={reviewCount}
            className={floating ? "min-w-0 border-b-transparent" : "mt-4"}
          />
        </div>
        {floating && (
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            aria-label="Import from Instagram"
            className="btn btn-secondary btn-sm pointer-events-auto shrink-0 border-[var(--glass-border)] bg-[var(--glass-bg)] shadow-[var(--glass-shadow)] backdrop-blur-xl backdrop-saturate-150 hover:bg-surface/75"
          >
            <span className="sm:hidden">Import</span>
            <span className="hidden sm:inline">Import from Instagram</span>
          </button>
        )}
      </div>
      {/* Floating, every piece of Map Discovery's own content (the map,
          the search/results column, the search-history bar) positions
          itself with `fixed`, so this wrapper never needs to reserve
          page height for it — the page simply doesn't scroll on this
          tab. (It used to: an in-flow results table started one
          `100dvh` down, requiring a page scroll just to reach it. The
          results panel replacing that table floats over the map
          instead — see DiscoveryWorkspace.) */}
      <div className={floating ? "" : "mt-6"}>
        <div hidden={active !== "map"}>
          <DiscoveryWorkspace
            initialSearchId={params.id}
            mapVisible={active === "map"}
            onQueueChanged={() => setReviewRefreshToken((t) => t + 1)}
            importOpen={importOpen}
            onImportOpenChange={setImportOpen}
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
