"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export type BuildViewId = "planning" | "projects";

const LABEL: Record<BuildViewId, string> = { planning: "Planning", projects: "Projects" };
const DEFAULT_HREF: Record<BuildViewId, string> = {
  planning: "/dashboard/build/planning",
  projects: "/dashboard/build/projects",
};

/**
 * Same pill-toggle position and styling as the Comfortable/Compact
 * DensityToggle it replaces in this workspace — but this switches the
 * actual view (real navigation to a real URL), not a display
 * preference, so it's built from <Link>s rather than a local setter.
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
export function BuildSwitch({ active }: { active: BuildViewId }) {
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

  return (
    <div className="flex rounded-md border border-border-strong p-0.5 text-sm" role="group" aria-label="Build view">
      {(["planning", "projects"] as const).map((view) => (
        <Link
          key={view}
          href={hrefs[view]}
          aria-current={active === view ? "page" : undefined}
          className={`rounded px-2 py-1 transition-colors motion-reduce:transition-none ${
            active === view ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg"
          }`}
        >
          {LABEL[view]}
        </Link>
      ))}
    </div>
  );
}
