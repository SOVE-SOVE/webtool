"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type Me } from "@/lib/api";

export default function SettingsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    api.me().then(setMe).catch(() => {});
  }, []);

  async function handleLogout() {
    await api.logout();
    router.push("/login");
  }

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold text-neutral-900">Settings</h1>

      <div className="mt-6 max-w-md space-y-4 border border-neutral-200 p-4">
        <div>
          <p className="text-xs text-neutral-500">Operator account</p>
          <p className="mt-1 text-sm text-neutral-900">{me?.email ?? "—"}</p>
        </div>
        <p className="text-xs text-neutral-500">
          There&apos;s one operator account for this tool — see docs/03_AGENT_RULES.md. Editable
          preferences (notifications, integrations, etc.) will live here once they exist; there
          aren&apos;t any yet.
        </p>
        <button
          onClick={handleLogout}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
