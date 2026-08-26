"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { portalApi, PortalApiError, type PortalMe } from "@/lib/portalApi";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<PortalMe | null>(null);
  const [checking, setChecking] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    portalApi
      .me()
      .then(setMe)
      .catch((err) => {
        if (err instanceof PortalApiError && err.status === 401) {
          router.push("/portal/login");
          return;
        }
        setLoadError(
          err instanceof PortalApiError
            ? err.message
            : "Couldn't reach the server. Check your connection, then try again.",
        );
      })
      .finally(() => setChecking(false));
  }, [router, retryCount]);

  async function handleLogout() {
    await portalApi.logout();
    router.push("/portal/login");
  }

  if (checking) {
    return <main className="p-8 text-sm text-neutral-500">Loading…</main>;
  }

  if (loadError) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="max-w-sm space-y-3 text-center">
          <h1 className="text-lg font-semibold text-neutral-900">Can&apos;t load your portal</h1>
          <p className="text-sm text-neutral-600">{loadError}</p>
          <button
            onClick={() => {
              setChecking(true);
              setLoadError(null);
              setRetryCount((c) => c + 1);
            }}
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
          <span className="text-sm font-semibold text-neutral-900">Client Portal</span>
          <p className="mt-0.5 truncate text-xs text-neutral-500">{me.business_name}</p>
        </div>

        <nav className="flex-1 px-2 py-3">
          <span className="block rounded-md bg-neutral-900 px-3 py-2 text-sm text-white">Project</span>
        </nav>

        <div className="border-t border-neutral-200 px-4 py-3">
          <p className="truncate text-xs font-medium text-neutral-700">{me.name}</p>
          <p className="truncate text-xs text-neutral-500">{me.email}</p>
          <button onClick={handleLogout} className="mt-1 text-xs text-neutral-500 hover:text-neutral-900">
            Sign out
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-x-auto">{children}</main>
    </div>
  );
}
