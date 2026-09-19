"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api, ApiError, type Me } from "@/lib/api";
import { MOBILE_PRIMARY_HREFS, NAV_SECTIONS, isNavLinkActive, type NavLink as NavLinkType } from "@/lib/nav";
import { loadNavCounts, peekNavCounts, type NavCounts } from "@/lib/navCounts";
import { ActivityIndicatorButton } from "@/components/activity/ActivityIndicatorButton";
import { Sidebar } from "@/components/nav/Sidebar";
import { CommandMenuButton, CommandMenuProvider } from "@/components/ui/CommandMenuProvider";
import { ConfirmProvider } from "@/components/ui/ConfirmProvider";
import { NavIcon } from "@/components/ui/Icons";
import { ToastProvider } from "@/components/ui/ToastProvider";

// The mobile bottom nav's five primary destinations, resolved once from
// the shared nav data so their icon/label never drifts from the sidebar.
const MOBILE_LINKS: NavLinkType[] = MOBILE_PRIMARY_HREFS.map(
  (href) => NAV_SECTIONS.flatMap((s) => s.links).find((l) => l.href === href)!,
);

function BottomNav({
  pathname,
  search,
  onOpenMore,
}: {
  pathname: string;
  search: URLSearchParams;
  onOpenMore: () => void;
}) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex h-14 items-stretch border-t border-border bg-surface lg:hidden">
      {MOBILE_LINKS.map((link) => {
        const active = isNavLinkActive(pathname, search, link);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring ${
              active ? "text-fg" : "text-fg-muted"
            }`}
          >
            {active && <span aria-hidden="true" className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-accent" />}
            <NavIcon name={link.icon} className="h-5 w-5" />
            <span className="truncate">{link.label === "Map Discovery" ? "Discover" : link.label}</span>
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onOpenMore}
        className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
          <path d="M4.5 10a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm7 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm5.5 1.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
        </svg>
        <span>More</span>
      </button>
    </nav>
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
        {/* Mobile / tablet top bar */}
        <div className="fixed inset-x-0 top-0 z-30 flex h-12 items-center justify-between border-b border-border bg-surface px-3 lg:hidden">
          <button
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
            className="rounded-md p-2 text-fg-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path
                fillRule="evenodd"
                d="M2 5.5A.75.75 0 0 1 2.75 4.75h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 5.5Zm0 4.75a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Zm0 4.75a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          <span className="flex items-center gap-2 text-sm font-semibold text-fg">
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-sm bg-accent" />
            Web Design OS
          </span>
          <span className="w-9" />
        </div>

        {/* Mobile / tablet drawer — doubles as the bottom nav's "More" menu */}
        {mobileNavOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div
              className="modal-overlay !items-stretch !justify-start !p-0"
              onClick={() => setMobileNavOpen(false)}
            >
              <aside
                className="flex h-full w-64 flex-col border-r border-border bg-surface"
                onClick={(e) => e.stopPropagation()}
              >
                <Sidebar
                  variant="mobile"
                  me={me}
                  pathname={pathname}
                  search={searchParams}
                  counts={counts}
                  onNavigate={() => setMobileNavOpen(false)}
                />
              </aside>
            </div>
          </div>
        )}

        {/* Desktop sidebar */}
        <Sidebar variant="desktop" me={me} pathname={pathname} search={searchParams} counts={counts} />

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
            never visibly stuck. Extra bottom padding on mobile keeps
            content clear of the fixed bottom nav. */}
        <main className="flex min-w-0 flex-1 flex-col pb-14 pt-12 lg:pb-0 lg:pt-0">
          {/* Desktop-only header strip — pinned so the activity/search
              entry points stay reachable while scrolling a long page.
              No breadcrumbs/title: kept minimal on purpose. */}
          <div className="sticky top-0 z-30 hidden h-11 shrink-0 items-center justify-end gap-2 border-b border-border bg-surface px-4 lg:flex">
            <CommandMenuButton />
            <ActivityIndicatorButton />
          </div>
          <div className="min-w-0 flex-1">{children}</div>
        </main>

        <BottomNav pathname={pathname} search={searchParams} onOpenMore={() => setMobileNavOpen(true)} />
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
