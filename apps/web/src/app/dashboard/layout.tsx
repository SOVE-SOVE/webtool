"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api, ApiError, type Me } from "@/lib/api";
import { HOME_LINK, NAV_SECTIONS, SETTINGS_LINK, isNavLinkActive, type NavLink as NavLinkType } from "@/lib/nav";
import { ConfirmProvider } from "@/components/ui/ConfirmProvider";
import { DoThisNext } from "@/components/ui/DoThisNext";
import { NavIcon } from "@/components/ui/Icons";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

function NavLink({
  link,
  active,
  onNavigate,
}: {
  link: NavLinkType;
  active: boolean;
  onNavigate?: () => void;
}) {
  if (link.secondary) {
    return (
      <Link
        href={link.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={`block rounded-md py-1.5 pl-[2.375rem] pr-3 text-[13px] transition-colors ${
          active ? "font-medium text-fg" : "text-fg-subtle hover:text-fg"
        }`}
      >
        {link.label}
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
    </Link>
  );
}

function SidebarContent({ me, pathname, onNavigate }: { me: Me; pathname: string; onNavigate?: () => void }) {
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
        <NavLink
          link={HOME_LINK}
          active={isNavLinkActive(pathname, HOME_LINK)}
          onNavigate={onNavigate}
        />

        {NAV_SECTIONS.map((section) => (
          <div key={section.id} className="mt-5">
            <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
              {section.label}
            </p>
            <div className="mt-1 space-y-0.5">
              {section.links.map((link) => (
                <NavLink
                  key={link.href}
                  link={link}
                  active={isNavLinkActive(pathname, link)}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>
        ))}

        <div className="mt-5 border-t border-border pt-3">
          <NavLink
            link={SETTINGS_LINK}
            active={isNavLinkActive(pathname, SETTINGS_LINK)}
            onNavigate={onNavigate}
          />
        </div>
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

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
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

        {/* Mobile / tablet drawer */}
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
                <SidebarContent me={me} pathname={pathname} onNavigate={() => setMobileNavOpen(false)} />
              </aside>
            </div>
          </div>
        )}

        {/* Desktop sidebar */}
        <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface-subtle lg:flex">
          <SidebarContent me={me} pathname={pathname} />
        </aside>

        {/* `overflow-x-auto` keeps wide tables/boards scrolling inside the
            content area rather than the whole page. DoThisNext sits after
            the page content — pinned to the bottom of the scroll area, its
            own list capped and internally scrollable so it never stretches
            the page. */}
        <main className="flex min-w-0 flex-1 flex-col overflow-x-auto pt-12 lg:pt-0">
          <div className="min-w-0 flex-1">{children}</div>
          <DoThisNext />
        </main>
      </div>
    </ConfirmProvider>
  );
}
