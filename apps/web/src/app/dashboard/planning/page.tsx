"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, PLANNING_STATUS_LABELS, type PlanningListItem } from "@/lib/api";
import { useConfirm } from "@/components/ui/ConfirmProvider";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/ToastProvider";
import { STATUS_BADGE_CLASS } from "./lib";

export default function PlanningListPage() {
  const confirm = useConfirm();
  const showToast = useToast();
  const [items, setItems] = useState<PlanningListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  function load() {
    api
      .listPlanning()
      .then((list) => {
        setError(null);
        setItems(list);
      })
      .catch(() => setError("Couldn't load Planning."));
  }

  useEffect(load, []);

  async function handleRemove(item: PlanningListItem) {
    const ok = await confirm({
      title: `Remove this Planning item?`,
      description:
        `This removes the Planning record for ${item.website_url ?? item.lead_business_name} — including its ` +
        `audit findings and screenshots. It does not delete the ${item.lead_business_name} lead, or any client ` +
        `or project attached to it. You can start Planning for this lead again later.`,
      confirmLabel: "Remove from Planning",
      danger: true,
    });
    if (!ok) return;

    setRemovingId(item.id);
    try {
      await api.deletePlanning(item.id);
      setItems((prev) => (prev ?? []).filter((i) => i.id !== item.id));
      showToast("Removed from Planning.");
    } catch {
      showToast("Couldn't remove this Planning item.", "error");
    } finally {
      setRemovingId(null);
    }
  }

  if (error) {
    return (
      <div className="p-4 sm:p-6">
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Planning"
        description="Automated website analysis run against a lead's existing site — a neutral summary and evidence-backed key points to prepare the next conversation and the build, before any Project exists."
      />

      {items === null ? (
        <TableSkeleton rows={5} cols={4} />
      ) : items.length === 0 ? (
        <EmptyState
          title="No Planning items yet"
          description={'Start one from a lead’s "Start Planning" action.'}
          action={
            <Link href="/dashboard/leads" className="btn btn-primary btn-sm">
              Go to Leads →
            </Link>
          }
        />
      ) : (
        <div className="table-shell hidden md:block">
          <table className="table">
            <thead>
              <tr>
                <th className="px-3 py-2">Business</th>
                <th className="px-3 py-2">Website</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2"></th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-2">
                    <Link href={`/dashboard/leads/${item.lead_id}`} className="font-medium text-fg hover:underline">
                      {item.lead_business_name}
                    </Link>
                  </td>
                  <td className="max-w-[260px] truncate px-3 py-2 text-sm text-fg-muted">
                    {item.website_url ?? "No website yet"}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[item.status]}`}>
                      {PLANNING_STATUS_LABELS[item.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-sm text-fg-muted">{new Date(item.created_at).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/dashboard/planning/${item.id}`} className="text-sm font-medium text-fg hover:underline">
                      Open →
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => handleRemove(item)}
                      disabled={removingId === item.id}
                      className="text-sm text-fg-muted hover:text-fg hover:underline disabled:opacity-50"
                    >
                      {removingId === item.id ? "Removing…" : "Remove"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Mobile list */}
      {items !== null && items.length > 0 && (
        <ul className="divide-y divide-border border border-border md:hidden">
          {items.map((item) => (
            <li key={item.id} className="px-3 py-3">
              <Link href={`/dashboard/planning/${item.id}`} className="font-medium text-fg hover:underline">
                {item.lead_business_name}
              </Link>
              <p className="mt-0.5 truncate text-xs text-fg-muted">{item.website_url ?? "No website yet"}</p>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[item.status]}`}>
                    {PLANNING_STATUS_LABELS[item.status]}
                  </span>
                  <span className="text-xs text-fg-subtle">{new Date(item.created_at).toLocaleDateString()}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(item)}
                  disabled={removingId === item.id}
                  className="text-xs text-fg-muted hover:text-fg hover:underline disabled:opacity-50"
                >
                  {removingId === item.id ? "Removing…" : "Remove"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
