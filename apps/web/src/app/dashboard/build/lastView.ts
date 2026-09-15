export type BuildView = "planning" | "projects";

const LAST_VIEW_KEY = "wdos-build-last-view";

/** Which view a bare /dashboard/build visit should land on — read once,
 * client-side only (SSR/first paint always has no localStorage yet, so
 * callers treat this as a post-mount decision, same convention as
 * useDensity/useClientTab elsewhere in this app). Defaults to Planning:
 * the first stage of the real workflow ("understand the site, then
 * build the new one" — see lib/nav.ts), not an arbitrary choice. */
export function getLastBuildView(): BuildView {
  if (typeof window === "undefined") return "planning";
  return localStorage.getItem(LAST_VIEW_KEY) === "projects" ? "projects" : "planning";
}

export function setLastBuildView(view: BuildView): void {
  localStorage.setItem(LAST_VIEW_KEY, view);
}
