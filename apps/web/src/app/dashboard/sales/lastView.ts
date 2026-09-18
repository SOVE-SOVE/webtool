export type SalesView = "leads" | "pipeline" | "follow-ups";

const LAST_VIEW_KEY = "wdos-sales-last-view";

/** Which view a bare /dashboard/sales visit should land on — read once,
 * client-side only (SSR/first paint always has no localStorage yet, so
 * callers treat this as a post-mount decision, same convention as
 * useDensity/useClientTab elsewhere in this app). Defaults to Leads:
 * the primary, highest-traffic view of the three (see lib/nav.ts). */
export function getLastSalesView(): SalesView {
  if (typeof window === "undefined") return "leads";
  const stored = localStorage.getItem(LAST_VIEW_KEY);
  return stored === "pipeline" || stored === "follow-ups" ? stored : "leads";
}

export function setLastSalesView(view: SalesView): void {
  localStorage.setItem(LAST_VIEW_KEY, view);
}
