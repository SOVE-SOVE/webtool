"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, type Me } from "@/lib/api";

export default function DashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    api
      .me()
      .then(setMe)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          router.push("/login");
        }
      })
      .finally(() => setChecking(false));
  }, [router]);

  async function handleLogout() {
    await api.logout();
    router.push("/login");
  }

  if (checking) {
    return <main className="p-8 text-sm text-neutral-500">Loading…</main>;
  }

  if (!me) return null;

  return (
    <main className="min-h-screen bg-neutral-50">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-4">
        <h1 className="text-base font-semibold text-neutral-900">Web Design OS</h1>
        <div className="flex items-center gap-4 text-sm text-neutral-600">
          <span>{me.email}</span>
          <button onClick={handleLogout} className="text-neutral-500 hover:text-neutral-900">
            Sign out
          </button>
        </div>
      </header>

      <div className="p-6">
        <p className="text-sm text-neutral-500">
          M0 foundation — the pipeline board (prospects, projects, and every stage in
          between) lands in M1.
        </p>
      </div>
    </main>
  );
}
