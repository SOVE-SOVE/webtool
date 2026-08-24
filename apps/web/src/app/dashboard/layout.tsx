"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api, ApiError, type Me } from "@/lib/api";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/discovery", label: "Discovery" },
  { href: "/dashboard/review", label: "Review" },
  { href: "/dashboard/leads", label: "Leads" },
  { href: "/dashboard/pipeline", label: "Pipeline" },
  { href: "/dashboard/follow-ups", label: "Follow-ups" },
  { href: "/dashboard/clients", label: "Clients" },
  { href: "/dashboard/projects", label: "Projects" },
  { href: "/dashboard/tasks", label: "Tasks" },
  { href: "/dashboard/calendar", label: "Calendar" },
  { href: "/dashboard/settings", label: "Settings" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

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

  async function handleLogout() {
    await api.logout();
    router.push("/login");
  }

  if (checking) {
    return <main className="p-8 text-sm text-neutral-500">Loading…</main>;
  }

  if (loadError) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="max-w-sm space-y-3 text-center">
          <h1 className="text-lg font-semibold text-neutral-900">Can&apos;t load your workspace</h1>
          <p className="text-sm text-neutral-600">{loadError}</p>
          <button
            onClick={() => setRetryCount((c) => c + 1)}
            className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Try again
          </button>
        </div>
      </main>
    );
  }

  if (!me) return null;

  return (
    <div className="flex min-h-screen bg-white">
      <aside className="flex w-56 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50">
        <div className="border-b border-neutral-200 px-4 py-4">
          <span className="text-sm font-semibold text-neutral-900">Web Design OS</span>
          <p className="mt-0.5 truncate text-xs text-neutral-500">{me.workspace_name}</p>
        </div>

        <nav className="flex-1 px-2 py-3">
          {NAV_ITEMS.map((item) => {
            const active = item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-md px-3 py-2 text-sm ${
                  active
                    ? "bg-neutral-900 text-white"
                    : "text-neutral-700 hover:bg-neutral-200"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-neutral-200 px-4 py-3">
          <p className="truncate text-xs font-medium text-neutral-700">{me.name}</p>
          <p className="truncate text-xs text-neutral-500">
            {me.email} · {me.role}
          </p>
          <button onClick={handleLogout} className="mt-1 text-xs text-neutral-500 hover:text-neutral-900">
            Sign out
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-x-auto">{children}</main>
    </div>
  );
}
