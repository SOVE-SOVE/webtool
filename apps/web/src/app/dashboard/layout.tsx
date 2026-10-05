"use client";

import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api, ApiError, type Me } from "@/lib/api";
import {
  MOBILE_PRIMARY_HREFS,
  NAV_SECTIONS,
  isNavLinkActive,
  pageFadeKey,
  type NavLink as NavLinkType,
} from "@/lib/nav";
import { loadNavCounts, peekNavCounts, type NavCounts } from "@/lib/navCounts";
import { useOverlayExit } from "@/lib/useOverlayExit";
import { ActivityIndicatorButton } from "@/components/activity/ActivityIndicatorButton";
import { MoreNavIcon, PrimaryNavIcon, useNavIconHoverPlay } from "@/components/nav/AnimatedNavIcon";
import { Sidebar } from "@/components/nav/Sidebar";
import { CommandMenuButton, CommandMenuProvider } from "@/components/ui/CommandMenuProvider";
import { ConfirmProvider } from "@/components/ui/ConfirmProvider";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { Tooltip } from "@/components/ui/Tooltip";

// The bottom nav's five primary destinations, resolved once from the
// shared nav data so their icon/label never drifts from the nav sheet.
const MOBILE_LINKS: NavLinkType[] = MOBILE_PRIMARY_HREFS.map(
  (href) => NAV_SECTIONS.flatMap((s) => s.links).find((l) => l.href === href)!,
);

// The navigation sheet's shell. Its own component so it unmounts with the
// sheet, which is what lets it leave the way it came (useOverlayExit).
function NavSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useOverlayExit(rootRef);
  return (
    <div ref={rootRef} data-overlay-exit-root="" className="fixed inset-0 z-40">
      <div className="modal-overlay !items-stretch !justify-start !p-0" onClick={onClose}>
        <aside
          className="animate-slide-in-left flex h-full w-64 flex-col border-r border-border bg-surface"
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </aside>
      </div>
    </div>
  );
}

function BottomNavLink({ link, active }: { link: NavLinkType; active: boolean }) {
  // Same hover/keyboard-focus icon animation as the sidebar rows; a tap
  // (pointerType "touch") never plays it — see useNavIconHoverPlay.
  const iconPlay = useNavIconHoverPlay(link.icon);
  return (
    <Link
      href={link.href}
      aria-current={active ? "page" : undefined}
      onPointerEnter={iconPlay.onPointerEnter}
      onFocus={iconPlay.onFocus}
      className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring ${
        active ? "text-fg" : "text-fg-muted hover:text-fg"
      }`}
    >
      {/* Inset by a share of the item, not a fixed 24px, so the bar stays
          visible on six ~53px items at a 320px width. */}
      {active && <span aria-hidden="true" className="absolute inset-x-[25%] top-0 h-0.5 rounded-full bg-accent" />}
      <PrimaryNavIcon
        name={link.icon}
        className="h-5 w-5"
        playToken={iconPlay.playToken}
        onPlayEnd={iconPlay.onPlayEnd}
      />
      <span className="max-w-full truncate">{link.label === "Map Discovery" ? "Discover" : link.label}</span>
    </Link>
  );
}

// Mirrors "page content has scrolled beneath the top bar" onto the bar's
// `data-scrolled`, which globals.css (.app-bar-scroll-shadow) turns into
// its soft shadow. The window is the dashboard's scroll container (see
// <main> below), so the Discovery map, drawers and other inner scrollers
// never set it. Written straight to the DOM from a passive listener — no
// React render per scroll — and only when the value flips. `> 0` also
// keeps rubber-band overscroll (negative scrollY) at rest. Scroll events
// cover restored offsets, anchors and programmatic scrolls; `routeKey`
// re-reads the position after each navigation as well, so a new page at
// the top resets the bar even if no scroll event is delivered.
function useScrolledBeneath(barRef: React.RefObject<HTMLElement | null>, mounted: boolean, routeKey: string) {
  useEffect(() => {
    const bar = barRef.current;
    if (!mounted || !bar) return;
    const sync = () => {
      const scrolled = window.scrollY > 0 ? "true" : "false";
      if (bar.dataset.scrolled !== scrolled) bar.dataset.scrolled = scrolled;
    };
    sync();
    window.addEventListener("scroll", sync, { passive: true });
    return () => window.removeEventListener("scroll", sync);
  }, [barRef, mounted, routeKey]);
}

function BottomNav({
  pathname,
  search,
  onOpenMore,
}: {
  pathname: string;
  search: URLSearchParams;
  onOpenMore: () => void;
}) {
  // The app's only navigation bar, at every width (the desktop sidebar
  // was retired). The bar's surface spans the viewport, but the items sit
  // in a centred column capped at 36rem so six targets don't stretch
  // ~240px apart on a 1440px screen — the same compact spacing as on a
  // phone. Height is `--app-bottom-nav-h` (globals.css): 3.5rem plus the
  // safe-area inset, which <main> reserves as bottom padding. Frosted
  // glass (.app-bar-glass), so content scrolls visibly beneath it.
  return (
    <nav
      aria-label="Main"
      className="app-bar-glass fixed inset-x-0 bottom-0 z-30 h-[var(--app-bottom-nav-h)] border-t pb-[env(safe-area-inset-bottom,0px)]"
    >
      <div className="mx-auto flex h-full max-w-xl items-stretch">
        {MOBILE_LINKS.map((link) => (
          <BottomNavLink key={link.href} link={link} active={isNavLinkActive(pathname, search, link)} />
        ))}
        <BottomNavMoreButton onOpenMore={onOpenMore} />
      </div>
    </nav>
  );
}

function BottomNavMoreButton({ onOpenMore }: { onOpenMore: () => void }) {
  // Same trigger rules as the links' icons (useNavIconHoverPlay): bound on
  // the button, so icon↔label moves don't re-fire; touch and mouse-click
  // focus never play; the click opens the sheet without waiting for it.
  const iconPlay = useNavIconHoverPlay("more");
  return (
    <button
      type="button"
      onClick={onOpenMore}
      onPointerEnter={iconPlay.onPointerEnter}
      onFocus={iconPlay.onFocus}
      className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring"
    >
      <MoreNavIcon className="h-5 w-5" playToken={iconPlay.playToken} onPlayEnd={iconPlay.onPlayEnd} />
      <span>More</span>
    </button>
  );
}

// useSearchParams() needs a Suspense-boundary ancestor to opt into CSR
// during Next's static generation (it can't know a query-only
// navigation — e.g. Leads vs Clients, both /dashboard/leads — happened
// without it, unlike usePathname()). See the default export below.
function DashboardLayoutInner({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [counts, setCounts] = useState<NavCounts | null>(peekNavCounts());
  const [lastPathname, setLastPathname] = useState(pathname);
  // Close the mobile drawer whenever navigation happens — adjusted during
  // render (React's recommended pattern for resetting state on a prop
  // change) rather than in an effect, so it takes effect on the same paint.
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setMobileNavOpen(false);
  }

  // setChecking/setLoadError reset the previous attempt's result before a
  // fresh `api.me()` call (initial mount, or a "Try again" retry) — a
  // deliberate synchronous reset, not a derived-state anti-pattern.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setChecking(true);
    setLoadError(null);
    api
      .me()
      .then(setMe)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          router.push("/login");
          return;
        }
        // Anything else — API down, 500, network blip — must say so.
        // Falling through to `if (!me) return null` renders a blank
        // page with no explanation and no way out.
        setLoadError(
          err instanceof ApiError
            ? err.message
            : "Couldn't reach the API. Check that it's running, then try again.",
        );
      })
      .finally(() => setChecking(false));
  }, [router, retryCount]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // The sidebar's two badge counts — fetched once per short window
  // (lib/navCounts.ts), shared across every page. Refetches on
  // navigation so acting on an item (e.g. approving a review item) is
  // reflected soon after returning to a list page, without polling
  // constantly.
  useEffect(() => {
    let alive = true;
    loadNavCounts()
      .then((c) => alive && setCounts(c))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pathname]);

  const topBarRef = useRef<HTMLDivElement>(null);
  useScrolledBeneath(topBarRef, !checking && !loadError && me !== null, `${pathname}?${searchParams}`);

  if (checking) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <p className="text-sm text-fg-muted">Loading your workspace…</p>
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="max-w-sm space-y-3 text-center">
          <h1 className="page-title">Can&apos;t load your workspace</h1>
          <p className="text-sm text-fg-muted">{loadError}</p>
          <button onClick={() => setRetryCount((c) => c + 1)} className="btn btn-primary">
            Try again
          </button>
        </div>
      </main>
    );
  }

  if (!me) return null;

  return (
    <ConfirmProvider>
    <ToastProvider>
    <CommandMenuProvider>
      <div className="flex min-h-screen bg-canvas">
        {/* Top bar — every width. Left: opens the same navigation sheet as
            the bottom bar's "More". From `lg` up the right side also holds
            the search and background-activity entry points that used to
            live in the retired desktop header strip (below `lg` they were
            never shown, and still aren't). A 3-column grid keeps the title
            centred whatever width the right side takes. Frosted glass
            (.app-bar-glass) like the bottom nav. One step above the
            bottom nav's z-30: the activity side panel renders inside this
            bar, so its full-screen overlay must also cover the nav. Its
            shadow shows only once content has scrolled beneath it
            (useScrolledBeneath); at the top it rests on the hairline. */}
        <div ref={topBarRef} className="app-bar-glass app-bar-scroll-shadow fixed inset-x-0 top-0 z-[31] grid h-12 grid-cols-[1fr_auto_1fr] items-center border-b px-3">
          <Tooltip label="Menu">
            <button
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation"
              className="justify-self-start rounded-md p-2 text-fg-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                <path
                  fillRule="evenodd"
                  d="M2 5.5A.75.75 0 0 1 2.75 4.75h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 5.5Zm0 4.75a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Zm0 4.75a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </Tooltip>
          <span className="flex items-center gap-2 text-sm font-semibold text-fg">
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-sm bg-accent" />
            Web Design OS
          </span>
          <div className="hidden items-center justify-self-end gap-2 lg:flex">
            <CommandMenuButton />
            <ActivityIndicatorButton />
          </div>
        </div>

        {/* Navigation sheet — opened from the top bar or the bottom bar's
            "More"; the only place the full Sidebar rows (every destination,
            badges, account/theme menu) render. */}
        {mobileNavOpen && (
          <NavSheet onClose={() => setMobileNavOpen(false)}>
            <Sidebar
              me={me}
              pathname={pathname}
              search={searchParams}
              counts={counts}
              onNavigate={() => setMobileNavOpen(false)}
            />
          </NavSheet>
        )}

        {/* No overflow-x-auto here (removed) — it used to catch wide
            tables/boards, but every one of those already wraps itself in
            its own overflow-x-auto (.table-shell, LeadsBoard,
            DiscoveryWorkspace's map/table), so it was redundant — and it
            had a real cost: setting overflow-x alone forces the browser
            to also compute overflow-y as non-visible (CSS's "asymmetric
            overflow" rule), which silently turned <main> into its own
            scroll container even though it never actually scrolled
            internally (content just grows to fit; the window scrolls).
            That phantom scroll container broke `position: sticky` for
            any descendant — sticky binds to the *nearest* scrolling
            ancestor, so a sticky child here resolved against <main>'s
            own (permanently 0) scrollTop instead of the window's, and
            never visibly stuck. The padding reserves the fixed top bar
            and the fixed bottom nav (incl. its safe-area inset) at every
            width. It sits inside the window's scroll, so the first and
            last content start clear of the glass bars, and everything
            in between scrolls beneath them (see globals.css). */}
        <main className="flex min-w-0 flex-1 flex-col pb-[var(--app-bottom-nav-h)] pt-12">
          {/* Keyed so a real page change replays a short opacity fade (no
              movement, so no layout shift); see pageFadeKey. */}
          <div key={pageFadeKey(pathname)} className="animate-fade-in min-w-0 flex-1">
            {children}
          </div>
        </main>

        <BottomNav
          pathname={pathname}
          search={searchParams}
          onOpenMore={() => setMobileNavOpen(true)}
        />
      </div>
    </CommandMenuProvider>
    </ToastProvider>
    </ConfirmProvider>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center p-8">
          <p className="text-sm text-fg-muted">Loading your workspace…</p>
        </main>
      }
    >
      <DashboardLayoutInner>{children}</DashboardLayoutInner>
    </Suspense>
  );
}
