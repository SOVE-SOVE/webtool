"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api, ApiError, type Me } from "@/lib/api";
import { ConfirmProvider } from "@/components/ui/ConfirmProvider";

type NavItem = { href: string; label: string };
type NavGroup = { label: string; items: NavItem[] };

// Grouped to mirror the pipeline stages in docs/00_VISION.md: find →
// qualify → contact → close → deliver → operate. A daily user should be
// able to tell at a glance which stage of the business a link belongs to.
const NAV_GROUPS: NavGroup[] = [
  {
    label: "Prospecting",
    items: [
      { href: "/dashboard/discovery", label: "Discovery" },
      { href: "/dashboard/review", label: "Review" },
    ],
  },
  {
    label: "Sales",
    items: [
      { href: "/dashboard/sales", label: "Command centre" },
      { href: "/dashboard/leads", label: "Leads" },
      { href: "/dashboard/pipeline", label: "Pipeline" },
      { href: "/dashboard/follow-ups", label: "Follow-ups" },
    ],
  },
  {
    label: "Delivery",
    items: [
      { href: "/dashboard/clients", label: "Clients" },
      { href: "/dashboard/projects", label: "Projects" },
    ],
  },
  {
    label: "Workspace",
    items: [
      { href: "/dashboard/tasks", label: "Tasks" },
      { href: "/dashboard/calendar", label: "Calendar" },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/dashboard" ? pathname === href : pathname.startsWith(href);
}

function NavLink({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate?: () => void }) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`block rounded-md px-3 py-2 text-sm transition-colors ${
        active ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-surface-hover hover:text-fg"
      }`}
    >
      {item.label}
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
        <NavLink item={{ href: "/dashboard", label: "Overview" }} active={pathname === "/dashboard"} onNavigate={onNavigate} />

        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mt-4">
            <p className="px-3 text-xs font-semibold uppercase tracking-wide text-fg-subtle">{group.label}</p>
            <div className="mt-1 space-y-0.5">
              {group.items.map((item) => (
                <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} onNavigate={onNavigate} />
              ))}
            </div>
          </div>
        ))}

        <div className="mt-4">
          <NavLink
            item={{ href: "/dashboard/settings", label: "Settings" }}
            active={isActive(pathname, "/dashboard/settings")}
            onNavigate={onNavigate}
          />
        </div>
      </nav>

      <div className="border-t border-border px-4 py-3">
        <p className="truncate text-xs font-medium text-fg">{me.name}</p>
        <p className="truncate text-xs text-fg-muted">
          {me.email} · {me.role}
        </p>
        <button onClick={handleLogout} className="mt-1 text-xs text-fg-muted hover:text-fg">
          Sign out
        </button>
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
        {/* Mobile top bar */}
        <div className="fixed inset-x-0 top-0 z-30 flex h-12 items-center justify-between border-b border-border bg-surface px-3 md:hidden">
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

        {/* Mobile drawer */}
        {mobileNavOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <div className="modal-overlay !p-0 !items-stretch !justify-start" onClick={() => setMobileNavOpen(false)}>
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
        <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface-subtle md:flex">
          <SidebarContent me={me} pathname={pathname} />
        </aside>

        <main className="min-w-0 flex-1 overflow-x-auto pt-12 md:pt-0">{children}</main>
      </div>
    </ConfirmProvider>
  );
}
