export type DiscoveryView = "map" | "review";

const LAST_VIEW_KEY = "wdos-discovery-last-view";

/** Which view a bare /dashboard/discovery visit should land on — read
 * once, client-side only (SSR/first paint always has no localStorage
 * yet, so callers treat this as a post-mount decision, same convention
 * as useDensity/useClientTab elsewhere in this app). Defaults to Map
 * Discovery: the primary, "where discovery starts" view of the two. */
export function getLastDiscoveryView(): DiscoveryView {
  if (typeof window === "undefined") return "map";
  const stored = localStorage.getItem(LAST_VIEW_KEY);
  return stored === "review" ? stored : "map";
}

export function setLastDiscoveryView(view: DiscoveryView): void {
  localStorage.setItem(LAST_VIEW_KEY, view);
}
