import { useRef, useState } from "react";
import type { IconName } from "@/lib/nav";
import { NavIcon } from "@/components/ui/Icons";

/**
 * The one-shot section-icon animation on the main nav's primary rows
 * (desktop sidebar, mobile drawer, mobile bottom nav). It plays once when
 * a mouse/pen pointer enters the row, or when the row receives keyboard
 * focus — see `useNavIconHoverPlay` below for the exact trigger rules.
 * It never runs on click or on navigation, so it can't delay either.
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
 * The bottom nav's "More" glyph — not a nav destination, so it has no
 * `IconName`/`NavIcon` entry; its rest icon has always been this 20×20
 * filled three-dot SVG (dots r=1.5 at x=3/10/17). Its single path is
 * split into one `<path>` per dot, keeping the exact subpath data (a
 * `<circle>` rasterizes with slightly more ink than these arcs), so
 * each can lift in turn: a left-to-right wave, staggered in globals.css
 * (`.nav-icon-play-more`). Same trigger/replay rules as the section
 * icons: pass `useNavIconHoverPlay("more")`'s `playToken`/`onPlayEnd`.
 * At rest and under reduced motion no animation class is applied.
 */
export function MoreNavIcon({
  className = "h-5 w-5",
  playToken = 0,
  onPlayEnd,
}: {
  className?: string;
  playToken?: number;
  onPlayEnd?: () => void;
}) {
  const playing =
    playToken > 0 &&
    typeof window !== "undefined" &&
    !window.matchMedia(REDUCED_MOTION_QUERY).matches;
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className={playing ? `${className} nav-icon-play-more` : className}
      aria-hidden="true"
      key={playing ? playToken : undefined}
      onAnimationEnd={(e) => {
        if (e.currentTarget.getAnimations({ subtree: true }).length === 0) onPlayEnd?.();
      }}
    >
      <path d="M4.5 10a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" />
      <path d="M11.5 10a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" />
      <path d="M17 11.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
    </svg>
  );
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
// Comfortably longer than the longest play (`--duration-nav-icon`, 420ms).
const PLAY_GUARD_MS = 1000;

/**
 * Hover/keyboard trigger for a nav row's icon animation. Spread the
 * returned `onPointerEnter`/`onFocus` onto the row's link (the whole
 * item, so moving between its icon and label never re-fires — pointer
 * enter doesn't bubble from children) and pass `playToken`/`onPlayEnd`
 * to `PrimaryNavIcon`.
 *
 * - One play per entry; nothing loops while the pointer rests on it.
 * - A play that's already running is never restarted — a re-entry or a
 *   keyboard focus during it is ignored, and leaving mid-play lets it
 *   finish (every keyframe ends at the rest pose; cutting it short would
 *   snap the icon back abruptly). Once it ends, the next entry replays.
 * - Touch pointers are ignored, and the emulated mouseenter a tap also
 *   fires isn't listened to, so a tap just navigates — no motion, no
 *   delay.
 * - Focus plays only when the browser deems it `:focus-visible`
 *   (keyboard), so a mouse click that focuses the link can't re-trigger.
 * - Reduced motion: never starts; the row's own hover colour/background
 *   remains the only feedback.
 */
export function useNavIconHoverPlay(name: IconName | "more") {
  const [playToken, setPlayToken] = useState(0);
  // Start time of the running play, or null. The time check is only a
  // safety net: if the animation is cancelled rather than ending (e.g.
  // a breakpoint hides this nav mid-play), no animationend arrives, and
  // this keeps that from blocking every later play.
  const playStartRef = useRef<number | null>(null);
  const animatable = name === "more" || ANIMATED_VARIANTS[name] !== undefined;

  function play() {
    if (!animatable) return;
    const start = playStartRef.current;
    if (start !== null && performance.now() - start < PLAY_GUARD_MS) return;
    if (window.matchMedia(REDUCED_MOTION_QUERY).matches) return;
    playStartRef.current = performance.now();
    setPlayToken((t) => t + 1);
  }

  return {
    playToken,
    onPlayEnd: () => {
      playStartRef.current = null;
    },
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === "touch") return;
      play();
    },
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      if (e.currentTarget.matches(":focus-visible")) play();
    },
  };
}

/**
 * Drop-in replacement for `NavIcon` on the five primary nav rows —
 * renders the exact same icon at rest, and additionally plays that
 * section's one-shot animation whenever `playToken` becomes a new,
 * positive number. `key` on the `<svg>` forces React to remount it on
 * every new token, which is what restarts the CSS animation (a plain
 * class toggle wouldn't replay on an already-mounted element).
 * `onPlayEnd` fires once every animation inside the icon has finished
 * (Sales and Build run two staggered ones).
 */
export function PrimaryNavIcon({
  name,
  className = "h-5 w-5",
  playToken = 0,
  onPlayEnd,
}: {
  name: IconName;
  className?: string;
  playToken?: number;
  onPlayEnd?: () => void;
}) {
  const Animated = playToken > 0 ? ANIMATED_VARIANTS[name] : undefined;
  const reduceMotion =
    Animated !== undefined &&
    typeof window !== "undefined" &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches;

  if (!Animated || reduceMotion) {
    return <NavIcon name={name} className={className} />;
  }

  return (
    <svg
      {...ICON_SVG_PROPS}
      className={className}
      key={playToken}
      onAnimationEnd={(e) => {
        if (e.currentTarget.getAnimations({ subtree: true }).length === 0) onPlayEnd?.();
      }}
    >
      <Animated />
    </svg>
  );
}
