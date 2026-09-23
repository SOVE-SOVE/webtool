"use client";

import { useEffect, useState } from "react";
import { NavIcon } from "@/components/ui/Icons";
import { scheduleDelayedShow, visibleOnActiveChange } from "@/lib/delayedVisible";
import type { IconName } from "@/lib/nav";

/**
 * True only once `active` has stayed true for `delayMs` — never before.
 * A fast navigation (the common case) never flips this at all, so
 * nothing ever flashes on screen for a frame; there's no matching
 * minimum-display timer once it *does* flip, so it disappears the
 * instant `active` goes false (data arrived, an error replaced it, or
 * the surface using it just unmounted because the visitor navigated
 * away again). See `DelayedSectionLoading` for the one place this is
 * actually used.
 */
export function useDelayedVisible(active: boolean, delayMs: number): boolean {
  const [visible, setVisible] = useState(false);
  // Hide immediately the moment `active` goes false — adjusted during
  // render (React's "reset state on prop change" pattern, same as
  // AnimatedHeight's `prevOpen` and dashboard/layout.tsx's
  // `lastPathname`) rather than in the effect below, so there's no
  // extra render and no synchronous setState-in-effect. The decision
  // itself (`lib/delayedVisible.ts`) is what's unit-tested.
  const [prevActive, setPrevActive] = useState(active);
  if (active !== prevActive) {
    setPrevActive(active);
    setVisible(visibleOnActiveChange(active, visible));
  }
  useEffect(() => {
    if (!active) return;
    return scheduleDelayedShow(delayMs, () => setVisible(true));
  }, [active, delayMs]);
  return visible;
}

/**
 * A small, in-flow "still loading" row — a section's own icon (plain
 * `NavIcon`, not the sidebar's one-time animated variant: this is an
 * ongoing state, not a single acknowledgement, and giving it the same
 * motion would read as two competing animations for the same event) at
 * a gentle, continuous pulse, plus a plain-language label. Never
 * full-screen — callers place it inside their normal content padding.
 */
export function SectionLoadingIndicator({ icon, label }: { icon: IconName; label: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 p-4 text-sm text-fg-muted sm:p-6">
      <NavIcon name={icon} className="h-4 w-4 shrink-0 animate-pulse motion-reduce:animate-none" />
      <span>{label}</span>
    </div>
  );
}

/**
 * `SectionLoadingIndicator`, gated behind `useDelayedVisible` — mount
 * this in place of a route boundary that currently renders nothing
 * while it resolves (a `Suspense` fallback, a redirect stub's `return
 * null`). Its own mount is the "still loading" signal (there'd be
 * nothing to mount otherwise), so `active` is always true; unmounting
 * it (the real content or destination taking over) is what stops it —
 * cleanly, with no separate cancel path needed.
 *
 * Deliberately *not* used inside a page that already shows its own
 * skeleton for its real data fetch (Sales/Build/Clients/Today's tabs
 * all do) — stacking this on top of an already-adequate, already-
 * instant skeleton would be exactly the "two competing loaders" the
 * motion guidelines warn against, not an improvement on it. It exists
 * for the routing-level gap those pages' *shells* have no loading UI
 * for at all: the client-side view redirect Sales/Build/Discovery's
 * bare routes perform, and the `useSearchParams` CSR-bailout `Suspense`
 * boundary every one of the five top-level pages has.
 */
export function DelayedSectionLoading({
  icon,
  label,
  delayMs = 220,
}: {
  icon: IconName;
  label: string;
  delayMs?: number;
}) {
  const visible = useDelayedVisible(true, delayMs);
  if (!visible) return null;
  return <SectionLoadingIndicator icon={icon} label={label} />;
}

/**
 * The four sections' *content-loading* icons — a small, standalone,
 * monochrome SVG per section (distinct from `AnimatedNavIcon`'s sidebar
 * glyphs; this one never has to preserve a nav icon's resting shape, so
 * each is drawn as the literal concept the task asked for) with a short,
 * single-cycle CSS animation defined in globals.css
 * (`.content-loading-*` — see that block's own comment for why it's
 * kept entirely separate from `.nav-icon-play-*`). `pathLength={1}`
 * lets the drawn-stroke variants (Build) use a plain 0–1 `stroke-
 * dasharray`/`-dashoffset` regardless of the path's real length.
 */
const CONTENT_LOADING_SVG_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
};

function TodayClockIcon() {
  return (
    <svg {...CONTENT_LOADING_SVG_PROPS} className="h-4 w-4 shrink-0">
      <circle cx="12" cy="12" r="8.5" />
      <path className="content-loading-today-minute" d="M12 12V7" />
      <path className="content-loading-today-hour" d="M12 12l3 2" />
    </svg>
  );
}

function SalesBarsIcon() {
  return (
    <svg {...CONTENT_LOADING_SVG_PROPS} className="h-4 w-4 shrink-0">
      <path d="M4 20h16" />
      <rect className="content-loading-sales-bar content-loading-sales-bar-1" x="6" y="13" width="3" height="7" rx="0.5" />
      <rect className="content-loading-sales-bar content-loading-sales-bar-2" x="10.5" y="9" width="3" height="11" rx="0.5" />
      <rect className="content-loading-sales-bar content-loading-sales-bar-3" x="15" y="5" width="3" height="15" rx="0.5" />
    </svg>
  );
}

function BuildPencilIcon() {
  return (
    <svg {...CONTENT_LOADING_SVG_PROPS} className="h-4 w-4 shrink-0">
      <path d="m13.5 6.5 4 4M3.5 20.5l1-4L15 6a2 2 0 0 1 3 0l.5.5a2 2 0 0 1 0 3L8 20l-4.5.5Z" />
      <path className="content-loading-build-line" pathLength={1} d="M4.5 19.5 7.5 17.8" />
    </svg>
  );
}

function ClientsBriefcaseIcon() {
  return (
    <svg {...CONTENT_LOADING_SVG_PROPS} className="h-4 w-4 shrink-0">
      <rect x="3.5" y="7.5" width="17" height="12" rx="2" />
      <path className="content-loading-clients-lid" d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3.5 12.5h17" />
    </svg>
  );
}

/**
 * `ContentLoadingIndicator`/`DelayedSectionLoading` above answer "what
 * shows while we wait"; `.content-reveal` (globals.css) answers "how the
 * real content arrives once we're done waiting" — the two are meant to
 * be used together at the same boundary. Put `content-reveal` on the
 * element that replaces one of these once its data (or a real empty/
 * error result) is ready: a short fade + a small upward settle, whether
 * that swap happened under the 150ms delay (the loader never showed) or
 * after it (this is the loader's hand-off) — one reveal, always, with no
 * separate case for either path.
 *
 * It's a plain CSS class, not another component here, because every
 * existing call site already gives it exactly the one-shot mount it
 * needs for free: the node it's put on is created once real content is
 * ready and never torn down again by a background refetch, a filter, a
 * sort or a "load more" — those all re-render it in place. That's what
 * already keeps `.animate-fade-in` (globals.css) from replaying on a tab
 * switch's own re-renders, and it's the same guarantee this leans on, so
 * no extra "is this a fresh navigation" state or timer is needed beyond
 * what each page's own loading gate already provides. See the pages
 * under dashboard/{tasks,sales,build,clients} for call sites, and their
 * comments for the couple of places this was deliberately left off (an
 * already-good immediate-mount skeleton with its own progressive,
 * independently-loading sections, where a single reveal would either
 * duplicate or falsely unify what's actually several unrelated fetches).
 */
export type ContentLoadingVariant = "today" | "sales" | "build" | "clients";

const CONTENT_LOADING_ICON: Record<ContentLoadingVariant, () => React.ReactNode> = {
  today: TodayClockIcon,
  sales: SalesBarsIcon,
  build: BuildPencilIcon,
  clients: ClientsBriefcaseIcon,
};

/**
 * The section-specific *content*-loading indicator — for a page's own
 * real data fetch, as opposed to `DelayedSectionLoading`'s routing-level
 * gap above. Same `useDelayedVisible` delay-then-show, no-minimum-
 * display behaviour, but a distinct per-section icon/animation and a
 * caller-supplied label instead of the generic pulsing nav icon.
 *
 * Used only where a page had no adequate loading treatment of its own
 * (a bare "Loading…" string, or a generic non-shaped skeleton) — never
 * stacked on top of a page's own already-good, already-layout-matched
 * `Skeleton`/`*CardSkeleton` UI. See the task's session-log entry for
 * the per-page decision.
 *
 * Like `DelayedSectionLoading`, this is meant to be conditionally
 * mounted by the caller (the same `{!data && …}` / `if (!data) return
 * …` check that used to render the old loading UI) — unmounting it is
 * what stops it, on success, on error (the caller's own `ErrorState`
 * takes over instead), or on navigating away mid-load, with no separate
 * cancel path needed. The outer row always reserves a small minimum
 * height, even during the initial delay window, so the moment the icon
 * *does* appear (a slow fetch) it doesn't itself shift anything below
 * it — see the "Reserve sensible space" requirement in the task.
 */
export function ContentLoadingIndicator({
  variant,
  label,
  delayMs = 150,
  className = "p-4 sm:p-6",
}: {
  variant: ContentLoadingVariant;
  label: string;
  delayMs?: number;
  className?: string;
}) {
  const visible = useDelayedVisible(true, delayMs);
  const Icon = CONTENT_LOADING_ICON[variant];
  return (
    <div role="status" aria-live="polite" className={`flex min-h-11 items-center gap-2 text-sm text-fg-muted ${className}`}>
      {visible && (
        <>
          <Icon />
          <span>{label}</span>
        </>
      )}
    </div>
  );
}
