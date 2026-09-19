"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, type HostingPlan, type RevenueHostingPlan } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";
import { withParam } from "@/lib/url";
import { HOSTING_STATUS_CLASS } from "@/components/billing/ClientBillingSection";
import { ChangeFeeModal } from "@/components/billing/ChangeFeeModal";
import { HostingPlanEffectiveActionModal } from "@/components/billing/HostingPlanEffectiveActionModal";
import { CompactSelect } from "@/components/ui/CompactSelect";
import { EmptyState } from "@/components/ui/EmptyState";
import type { FilterChip } from "@/components/ui/FilterChips";
import { FilterField } from "@/components/ui/FilterPopover";
import type { RevenueFilterUi } from "./revenueFilterUi";
import { ErrorState } from "@/components/ui/ErrorState";
import { TableSkeleton } from "@/components/ui/Skeleton";

type StatusFilter = "active" | "paused" | "cancelled" | "all";

type PlanModal = { type: "pause" | "resume" | "cancel"; plan: HostingPlan } | { type: "fee"; plan: HostingPlan };

/** The Hosting view's own secondary filter — plan status, including
 * "All" so historical (cancelled) plans stay reachable — returned as the
 * body of the shared Filters popover plus its chip. "Active" is the
 * default view, so it isn't a chip; only a non-default status is. */
export function useHostingFilters(): RevenueFilterUi {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const status = (searchParams.get("status") as StatusFilter | null) ?? "active";

  function setStatus(next: StatusFilter) {
    router.replace(`${pathname}?${withParam(searchParams, "status", next === "active" ? null : next)}`, {
      scroll: false,
    });
  }

  const options: { value: StatusFilter; label: string }[] = [
    { value: "active", label: "Active" },
    { value: "paused", label: "Paused" },
    { value: "cancelled", label: "Cancelled" },
    { value: "all", label: "All (includes historical)" },
  ];

  const chips: FilterChip[] =
    status === "active"
      ? []
      : [{ id: "status", label: "Status", value: options.find((o) => o.value === status)?.label ?? status, onRemove: () => setStatus("active") }];

  const panel = (
    <FilterField label="Status">
      <CompactSelect aria-label="Filter by plan status" value={status} onValueChange={setStatus} options={options} />
    </FilterField>
  );
  return { panel, chips };
}

/** Row-level "⋯" menu — collapses Change fee/Pause/Resume/Cancel into one discoverable control instead of a button cluster in every row. */
function PlanActionsMenu({ plan, onAction }: { plan: RevenueHostingPlan; onAction: (modal: PlanModal) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Actions for ${plan.project_name}`}
        className="rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg"
      >
        ⋯
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <span className="menu-panel absolute right-0 z-20 mt-1 block w-36 rounded-md border border-border bg-surface py-1 shadow-lg">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onAction({ type: "fee", plan });
              }}
              className="block w-full px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover"
            >
              Change fee
            </button>
            {plan.status === "active" && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onAction({ type: "pause", plan });
                }}
                className="block w-full px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover"
              >
                Pause
              </button>
            )}
            {plan.status === "paused" && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onAction({ type: "resume", plan });
                }}
                className="block w-full px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover"
              >
                Resume
              </button>
            )}
            {plan.status !== "cancelled" && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onAction({ type: "cancel", plan });
                }}
                className="block w-full px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover"
              >
                Cancel
              </button>
            )}
          </span>
        </>
      )}
    </span>
  );
}

/**
 * Every hosting plan in the workspace with its client/project context —
 * the workspace-wide sibling of Client Billing's per-project hosting
 * rows, reusing the exact same status colours and management modals so
 * pausing/cancelling/changing a fee here behaves identically to doing
 * it from a Client's own Billing tab.
 */
export function HostingPlansTab({
  currency,
  dataVersion,
  onChanged,
  onClearAll,
}: {
  currency: string;
  dataVersion: number;
  onChanged: () => void;
  /** Clears the shared search box too — owned by the parent toolbar; see PaymentsTab's identical prop for why this can't just be a local setParam("q", null). */
  onClearAll: () => void;
}) {
  const searchParams = useSearchParams();
  const status = (searchParams.get("status") as StatusFilter | null) ?? "active";
  const search = (searchParams.get("q") ?? "").trim().toLowerCase();

  const [plans, setPlans] = useState<RevenueHostingPlan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<PlanModal | null>(null);

  function load() {
    api
      .listAllHostingPlans()
      .then((p) => {
        setError(null);
        setPlans(p);
      })
      .catch(() => setError("Couldn't load hosting plans."));
  }

  useEffect(load, [dataVersion]);

  function closeAndReload() {
    setModal(null);
    load();
    onChanged();
  }

  const byStatus = useMemo(() => {
    if (!plans) return [];
    if (status === "all") return plans;
    return plans.filter((p) => p.status === status);
  }, [plans, status]);

  const visible = useMemo(() => {
    if (!search) return byStatus;
    return byStatus.filter(
      (p) => (p.client_business_name ?? "").toLowerCase().includes(search) || p.project_name.toLowerCase().includes(search),
    );
  }, [byStatus, search]);

  if (error) {
    return <ErrorState message={error} onRetry={load} compact />;
  }

  if (!plans) {
    return <TableSkeleton rows={4} cols={6} />;
  }

  return (
    <div>
      {plans.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No hosting plans yet"
            description="Set up hosting for a Client's project from their Billing tab — plans and monthly fees will show up here."
          />
        </div>
      ) : visible.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title={search ? "No matching hosting plans" : `No ${status} hosting plans`}
            description="Try a different search or status filter."
            action={
              (search || status !== "active") && (
                <button onClick={onClearAll} className="btn btn-secondary btn-sm">
                  Clear filters
                </button>
              )
            }
          />
        </div>
      ) : (
        <div className="table-shell mt-3">
          <table className="table">
            <thead>
              <tr>
                <th className="px-3 py-2">Client</th>
                <th className="px-3 py-2">Hosted website</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Monthly fee</th>
                <th className="px-3 py-2">Next payment</th>
                <th className="px-3 py-2 text-right">Outstanding</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((plan) => (
                <tr key={plan.id}>
                  <td className="max-w-[14rem] px-3 py-2">
                    {plan.client_id ? (
                      <Link href={`/dashboard/clients/${plan.client_id}?tab=billing`} className="block truncate font-medium text-fg hover:underline">
                        {plan.client_business_name ?? "Client"}
                      </Link>
                    ) : (
                      <span className="block truncate text-fg-subtle">No client (prospect)</span>
                    )}
                  </td>
                  <td className="max-w-[12rem] px-3 py-2">
                    <Link href={`/dashboard/projects/${plan.project_id}`} className="block truncate text-fg hover:underline">
                      {plan.project_name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${HOSTING_STATUS_CLASS[plan.status]}`}>
                      {plan.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(plan.monthly_fee_cents, currency)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-fg-muted">
                    {plan.status === "cancelled" ? (
                      "—"
                    ) : (
                      <Link
                        href={`/dashboard/clients?tab=revenue&revenueTab=upcoming&calCursor=${plan.next_due_date}&day=${plan.next_due_date}`}
                        className="hover:underline"
                        title="View in Upcoming"
                      >
                        {formatDate(plan.next_due_date)}
                      </Link>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {plan.outstanding_cents > 0 ? (
                      <span className="text-fg">{formatMoney(plan.outstanding_cents, currency)}</span>
                    ) : (
                      <span className="text-fg-subtle">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <PlanActionsMenu plan={plan} onAction={setModal} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(modal?.type === "pause" || modal?.type === "resume" || modal?.type === "cancel") && (
        <HostingPlanEffectiveActionModal plan={modal.plan} action={modal.type} onClose={() => setModal(null)} onSaved={closeAndReload} />
      )}
      {modal?.type === "fee" && <ChangeFeeModal plan={modal.plan} onClose={() => setModal(null)} onSaved={closeAndReload} />}
    </div>
  );
}
