import type { IconName } from "@/lib/nav";
import { NavIcon } from "@/components/ui/Icons";

/**
 * The one-time sidebar-icon "acknowledgement" that plays when the user
 * deliberately navigates to a different main section (see
 * `dashboard/layout.tsx`, which computes `playToken` from a real
 * section change and never replays it for a no-op click, a tab switch
 * inside the same section, or a background refresh).
 *
 * Every animated variant below is built from the *same* path data as
 * `Icons.tsx`'s `PATHS` for that name — this never redesigns the resting
 * icon, it only re-groups its existing strokes into separate elements
 * so a specific stroke can be nudged, or adds a stroke that is fully
 * invisible at both the start and the end of the animation (the pencil's
 * short drawn line; the sales arrow's fade-in) so the icon is pixel-
 * identical to `NavIcon` the instant the animation isn't running.
 * `PrimaryNavIcon` below is what call sites actually render — it only
 * swaps in one of these while `playToken` is active, and falls back to
 * the plain `NavIcon` otherwise (including whenever the visitor has
 * `prefers-reduced-motion: reduce` set, so no motion is ever attempted).
 *
 * Concepts (see docs/… task notes): Today sweeps into place, Discovery
 * scans side to side, Sales' trend line draws in and the arrow lands,
 * Build's pencil tilts and traces a short line, Clients' case lid lifts
 * and settles. Today's rest icon is a house, not a clock face, so its
 * literal "clock hands sweep" idea is adapted into a sweep of the same
 * roofline the house icon already has, rather than inventing a clock
 * that would change what the icon looks like at rest — see the task
 * report for that trade-off.
 */
const ICON_SVG_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
};

function TodayAnimated() {
  return (
    <g className="nav-icon-play-today">
      <path d="M3 10.5 12 3l9 7.5M5.25 9.75V20a1 1 0 0 0 1 1H9.5v-5.25a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V21h3.25a1 1 0 0 0 1-1V9.75" />
    </g>
  );
}

function DiscoveryAnimated() {
  return (
    <g className="nav-icon-play-discovery">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-3.6-3.6" />
    </g>
  );
}

function SalesAnimated() {
  return (
    <>
      <path d="M4 19h16" />
      <path className="nav-icon-play-sales-line" pathLength={1} d="m5 15 4-4 3 3 6-7" />
      <path className="nav-icon-play-sales-arrow" d="M18 7h-3M18 7v3" />
    </>
  );
}

function BuildAnimated() {
  return (
    <g className="nav-icon-play-build">
      <path d="m13.5 6.5 4 4M3.5 20.5l1-4L15 6a2 2 0 0 1 3 0l.5.5a2 2 0 0 1 0 3L8 20l-4.5.5Z" />
      {/* The "short line" the pencil draws — invisible before and after
          the animation (opacity 0 at both the 0% and 100% keyframes),
          so the rest icon is unchanged. */}
      <path className="nav-icon-play-build-line" pathLength={1} d="M4.5 19.5 7 18" />
    </g>
  );
}

function ClientsAnimated() {
  return (
    <>
      <rect x="3.5" y="7.5" width="17" height="12" rx="2" />
      <path
        className="nav-icon-play-clients-lid"
        d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3.5 12.5h17"
      />
    </>
  );
}

const ANIMATED_VARIANTS: Partial<Record<IconName, () => React.ReactNode>> = {
  home: TodayAnimated,
  discovery: DiscoveryAnimated,
  sales: SalesAnimated,
  projects: BuildAnimated,
  clients: ClientsAnimated,
};

/**
 * Drop-in replacement for `NavIcon` on the sidebar's five primary rows
 * (and the mobile bottom nav's, which shows four of them) — renders the
 * exact same icon at rest, and additionally plays that section's
 * one-time animation when `playToken` is a new, positive number. `key`
 * on the inner `<g>`/fragment forces React to remount it on every new
 * token, which is what restarts the CSS animation (a plain class toggle
 * wouldn't replay on an already-mounted element).
 */
export function PrimaryNavIcon({
  name,
  className = "h-5 w-5",
  playToken = 0,
}: {
  name: IconName;
  className?: string;
  playToken?: number;
}) {
  const Animated = playToken > 0 ? ANIMATED_VARIANTS[name] : undefined;
  const reduceMotion =
    Animated !== undefined &&
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!Animated || reduceMotion) {
    return <NavIcon name={name} className={className} />;
  }

  return (
    <svg {...ICON_SVG_PROPS} className={className} key={playToken}>
      <Animated />
    </svg>
  );
}
