"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api, ApiError, type Me } from "@/lib/api";
import {
  MOBILE_PRIMARY_HREFS,
  NAV_SECTIONS,
  isNavLinkActive,
  type NavLink as NavLinkType,
} from "@/lib/nav";
import { loadNavCounts, peekNavCounts, type NavCounts } from "@/lib/navCounts";
import { ConfirmProvider } from "@/components/ui/ConfirmProvider";
import { DoThisNext } from "@/components/ui/DoThisNext";
import { NavIcon } from "@/components/ui/Icons";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { ToastProvider } from "@/components/ui/ToastProvider";

function CountBadge({ count }: { count: number | undefined }) {
  if (!count) return null;
  return (
    <span className="ml-auto shrink-0 rounded-full bg-surface-subtle px-1.5 py-0 text-[11px] font-medium text-fg-muted">
      {count > 99 ? "99+" : count}
    </span>
  );
}

function NavLink({
  link,
  active,
  count,
  onNavigate,
}: {
  link: NavLinkType;
  active: boolean;
  count?: number;
  onNavigate?: () => void;
}) {
  if (link.secondary) {
    return (
      <Link
        href={link.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={`flex items-center gap-2 rounded-md py-1.5 pl-[2.375rem] pr-3 text-[13px] transition-colors ${
          active ? "font-medium text-fg" : "text-fg-subtle hover:text-fg"
        }`}
      >
        <span className="truncate">{link.label}</span>
        <CountBadge count={count} />
      </Link>
    );
  }

  return (
    <Link
      href={link.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
        active
          ? "bg-accent font-medium text-accent-fg"
          : "text-fg-muted hover:bg-surface-hover hover:text-fg"
      }`}
    >
      <NavIcon name={link.icon} className="h-[18px] w-[18px] shrink-0" />
      <span className="truncate">{link.label}</span>
      <CountBadge count={count} />
    </Link>
  );
}

function SidebarContent({
  me,
  pathname,
  search,
  counts,
  onNavigate,
}: {
  me: Me;
  pathname: string;
  search: URLSearchParams;
  counts: NavCounts | null;
  onNavigate?: () => void;
}) {
  const router = useRouter();

  async function handleLogout() {
    await api.logout();
    router.push("/login");
  }

  return (
    <>
      <div className="border-b border-border px-4 py-4">
        <span className="text-sm font-semibold text-fg">Web Design OS</span>
        <p className="mt-0.5 truncate text-xs text-fg-muted">{me.workspace_name}</p>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {NAV_SECTIONS.map((section, i) => (
          <div key={section.id} className={i === 0 ? undefined : "mt-5"}>
            <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
              {section.label}
            </p>
            <div className="mt-1 space-y-0.5">
              {section.links.map((link) => (
                <NavLink
                  key={link.href}
                  link={link}
                  active={isNavLinkActive(pathname, search, link)}
                  count={link.countKey ? counts?.[link.countKey] : undefined}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-border px-4 py-3">
        <p className="truncate text-xs font-medium text-fg">{me.name}</p>
        <p className="truncate text-xs text-fg-muted">
          {me.email} · {me.role}
        </p>
        <div className="mt-2 flex items-center justify-between gap-2">
          <ThemeToggle />
          <button onClick={handleLogout} className="shrink-0 text-xs text-fg-muted hover:text-fg">
            Sign out
          </button>
        </div>
      </div>
    </>
  );
}

// The mobile bottom nav's five primary destinations, resolved once from
// the shared nav data so their icon/label never drifts from the sidebar.
const MOBILE_LINKS: NavLinkType[] = MOBILE_PRIMARY_HREFS.map(
  (href) => NAV_SECTIONS.flatMap((s) => s.links).find((l) => l.href === href)!,
);

function BottomNav({
  pathname,
  onOpenMore,
}: {
  pathname: string;
  onOpenMore: () => void;
}) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex h-14 items-stretch border-t border-border bg-surface lg:hidden">
      {MOBILE_LINKS.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${
              active ? "text-fg" : "text-fg-muted"
            }`}
          >
            <NavIcon name={link.icon} className="h-5 w-5" />
            <span className="truncate">{link.label === "Map Discovery" ? "Discover" : link.label}</span>
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onOpenMore}
        className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] text-fg-muted"
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

  // The sidebar's two badge counts — fetched once per short window
  // (lib/navCounts.ts), shared across every page the same way
  // lib/overview.ts backs <DoThisNext>. Refetches on navigation so
  // acting on an item (e.g. approving a review item) is reflected soon
  // after returning to a list page, without polling constantly.
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
      <div className="flex min-h-screen bg-canvas">
        {/* Mobile / tablet top bar */}
        <div className="fixed inset-x-0 top-0 z-30 flex h-12 items-center justify-between border-b border-border bg-surface px-3 lg:hidden">
          <button
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
            className="rounded-md p-2 text-fg-muted hover:bg-surface-hover"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path
                fillRule="evenodd"
                d="M2 5.5A.75.75 0 0 1 2.75 4.75h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 5.5Zm0 4.75a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Zm0 4.75a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          <span className="text-sm font-semibold text-fg">Web Design OS</span>
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
                <SidebarContent
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
        <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface-subtle lg:flex">
          <SidebarContent me={me} pathname={pathname} search={searchParams} counts={counts} />
        </aside>

        {/* `overflow-x-auto` keeps wide tables/boards scrolling inside the
            content area rather than the whole page. DoThisNext sits after
            the page content — pinned to the bottom of the scroll area, its
            own list capped and internally scrollable so it never stretches
            the page. Extra bottom padding on mobile keeps content clear of
            the fixed bottom nav. */}
        <main className="flex min-w-0 flex-1 flex-col overflow-x-auto pb-14 pt-12 lg:pb-0 lg:pt-0">
          <div className="min-w-0 flex-1">{children}</div>
          <DoThisNext />
        </main>

        <BottomNav pathname={pathname} onOpenMore={() => setMobileNavOpen(true)} />
      </div>
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
