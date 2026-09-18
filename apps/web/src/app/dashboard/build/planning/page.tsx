"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  api,
  PLANNING_STATUS_LABELS,
  PLANNING_STATUSES,
  type PlanningChecklistSummary,
  type PlanningListItem,
  type PlanningStatus,
} from "@/lib/api";
import { useConfirm } from "@/components/ui/ConfirmProvider";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/ToastProvider";
import { withParam } from "@/lib/url";
import { useDebouncedUrlSync } from "@/lib/useDebouncedUrlSync";
import { useScrollRestoration } from "@/lib/useScrollRestoration";
import { PLANNING_MODE_LABEL, planningListItemMode, type PlanningMode } from "@/app/dashboard/planning/lib";
import { BuildSwitch } from "../BuildSwitch";
import { setLastBuildView } from "../lastView";
import { PlanningCard, PlanningCardSkeleton } from "./PlanningCard";

type SortKey = "updated" | "created" | "name";
const SORT_LABEL: Record<SortKey, string> = {
  updated: "Recently updated",
  created: "Recently created",
  name: "Business name (A–Z)",
};

const PAGE_SIZE = 24;
// Density is no longer user-togglable in the Build workspace (the
// Comfortable/Compact control's position now hosts the Planning/
// Projects switch instead) — a single fixed default replaces it, same
// padding PlanningCard already used for "comfortable".
const DENSITY = "comfortable" as const;

// useSearchParams() needs a Suspense-boundary ancestor for Next's static
// generation — see dashboard/settings/page.tsx for the same pattern.
function PlanningListPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const confirm = useConfirm();
  const showToast = useToast();

  const [items, setItems] = useState<PlanningListItem[] | null>(null);
  const [checklists, setChecklists] = useState<PlanningChecklistSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const showTransferred = searchParams.has("transferred");
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const [statusFilter, setStatusFilter] = useState<PlanningStatus | "">("");
  const [modeFilter, setModeFilter] = useState<PlanningMode | "">("");
  const [sortBy, setSortBy] = useState<SortKey>("updated");
  const visibleCount = Math.max(PAGE_SIZE, Number(searchParams.get("show")) || PAGE_SIZE);

  useDebouncedUrlSync("search", search);

  // This view was the one the operator landed on — remembered so a bare
  // /dashboard/build visit (no explicit view) returns here next time.
  useEffect(() => {
    setLastBuildView("planning");
  }, []);

  function updateParam(key: string, value: string | null) {
    router.replace(`${pathname}?${withParam(searchParams, key, value)}`, { scroll: false });
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const status = searchParams.get("status");
    setStatusFilter(status && (PLANNING_STATUSES as readonly string[]).includes(status) ? (status as PlanningStatus) : "");
    const mode = searchParams.get("mode");
    setModeFilter(mode === "existing" || mode === "new" ? mode : "");
    const sort = searchParams.get("sort");
    setSortBy(sort === "created" || sort === "name" ? sort : "updated");
  }, [searchParams]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function load() {
    api
      .listPlanning({ includeTransferred: showTransferred })
      .then((list) => {
        setError(null);
        setItems(list);
      })
      .catch(() => setError("Couldn't load Planning."));
    api
      .listPlanningChecklistSummaries()
      .then(setChecklists)
      .catch(() => {}); // Progress is a nice-to-have on each card — its own fetch failing shouldn't block the list.
  }

  useEffect(load, [showTransferred]);

  // Only poll while something is actually running — a resting status
  // (ready_to_analyse, completed, needs_review, failed) never changes on
  // its own, same convention as the detail page's own polling effect.
  const anyAnalysing = items?.some((i) => i.status === "analysing") ?? false;
  useEffect(() => {
    if (!anyAnalysing) return;
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyAnalysing, showTransferred]);

  useEffect(() => {
    sessionStorage.setItem("wdos-list-return:planning", `${pathname}?${searchParams.toString()}`);
  }, [pathname, searchParams]);

  useScrollRestoration(items !== null);

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

  const checklistById = useMemo(() => {
    const map = new Map<string, PlanningChecklistSummary>();
    for (const c of checklists) map.set(c.planning_id, c);
    return map;
  }, [checklists]);

  const activeCount = useMemo(() => (items ? items.filter((i) => i.project_id === null).length : null), [items]);

  const activeFilterCount = [search, statusFilter, modeFilter].filter(Boolean).length;

  function clearFilters() {
    setSearch("");
    setStatusFilter("");
    setModeFilter("");
    let query = searchParams.toString();
    for (const key of ["search", "status", "mode"]) {
      query = withParam(new URLSearchParams(query), key, null);
    }
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }

  const visibleItems = useMemo(() => {
    if (!items) return null;
    const term = search.trim().toLowerCase();
    return items
      .filter((i) => !term || i.lead_business_name.toLowerCase().includes(term))
      .filter((i) => !statusFilter || i.status === statusFilter)
      .filter((i) => !modeFilter || planningListItemMode(i) === modeFilter)
      .sort((a, b) => {
        if (sortBy === "name") return a.lead_business_name.localeCompare(b.lead_business_name);
        if (sortBy === "created") return a.created_at < b.created_at ? 1 : -1;
        return a.updated_at < b.updated_at ? 1 : -1;
      });
  }, [items, search, statusFilter, modeFilter, sortBy]);

  const pagedItems = visibleItems?.slice(0, visibleCount) ?? null;

  if (error) {
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="Build" />
        <BuildSwitch active="planning" className="mt-4" />
        <div className="mt-6">
          <ErrorState message={error} onRetry={load} />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="Build" />
      <BuildSwitch active="planning" className="mt-4" />

      <div className="mt-6 space-y-4">
        <p className="max-w-2xl text-sm text-fg-muted">
          {activeCount === null
            ? "Automated website analysis run against a lead's existing site."
            : `${activeCount} active plan${activeCount === 1 ? "" : "s"} — where each one stands, and what to do next.`}
        </p>

        {items === null ? null : items.length === 0 ? (
          <EmptyState
            title="No Planning items yet"
            description={'Start one from a lead’s "Start Planning" action.'}
            action={
              <Link href="/dashboard/sales/leads" className="btn btn-primary btn-sm">
                Go to Leads →
              </Link>
            }
          />
        ) : (
          <>
            {/* Search + filters, compact toolbar above the grid. */}
            <div className="flex flex-wrap items-center gap-2">
              <input
                placeholder="Search business name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input w-56"
                aria-label="Search Planning by business name"
              />
              <select
                value={statusFilter}
                onChange={(e) => {
                  const next = e.target.value as PlanningStatus | "";
                  setStatusFilter(next);
                  updateParam("status", next || null);
                }}
                className="input w-auto"
                aria-label="Filter by status"
              >
                <option value="">Any status</option>
                {PLANNING_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {PLANNING_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              <select
                value={modeFilter}
                onChange={(e) => {
                  const next = e.target.value as PlanningMode | "";
                  setModeFilter(next);
                  updateParam("mode", next || null);
                }}
                className="input w-auto"
                aria-label="Filter by planning mode"
              >
                <option value="">Any type</option>
                <option value="existing">{PLANNING_MODE_LABEL.existing}</option>
                <option value="new">{PLANNING_MODE_LABEL.new}</option>
              </select>
              <select
                value={sortBy}
                onChange={(e) => {
                  const next = e.target.value as SortKey;
                  setSortBy(next);
                  updateParam("sort", next === "updated" ? null : next);
                }}
                className="input w-auto"
                aria-label="Sort by"
              >
                {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => (
                  <option key={key} value={key}>
                    {SORT_LABEL[key]}
                  </option>
                ))}
              </select>
              {activeFilterCount > 0 && (
                <button onClick={clearFilters} className="text-sm text-fg-muted hover:text-fg hover:underline">
                  Clear filters
                </button>
              )}

              <label className="ml-auto flex items-center gap-1.5 text-sm text-fg-muted">
                <input
                  type="checkbox"
                  checked={showTransferred}
                  onChange={(e) => updateParam("transferred", e.target.checked ? "1" : null)}
                />
                Show transferred
              </label>
            </div>

            {visibleItems && (
              <p className="text-xs text-fg-muted">
                {visibleItems.length} of {items.length} plan{items.length === 1 ? "" : "s"}
              </p>
            )}
          </>
        )}

        {items === null && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <PlanningCardSkeleton key={i} />
            ))}
          </div>
        )}

        {pagedItems && pagedItems.length === 0 && items && items.length > 0 && (
          <EmptyState
            title="No matches"
            description="Try adjusting your search or filters."
            action={
              <button onClick={clearFilters} className="btn btn-secondary btn-sm">
                Clear filters
              </button>
            }
          />
        )}

        {pagedItems && pagedItems.length > 0 && (
          <>
            <div className="animate-fade-in grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
              {pagedItems.map((item) => (
                <PlanningCard
                  key={item.id}
                  item={item}
                  checklist={checklistById.get(item.id)}
                  density={DENSITY}
                  onRemove={handleRemove}
                  removing={removingId === item.id}
                />
              ))}
            </div>

            {visibleItems && visibleItems.length > pagedItems.length && (
              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={() => updateParam("show", String(visibleCount + PAGE_SIZE))}
                  className="btn btn-secondary btn-sm"
                >
                  Load more ({visibleItems.length - pagedItems.length} remaining)
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function PlanningBuildView() {
  return (
    <Suspense fallback={<div className="p-4 sm:p-6" />}>
      <PlanningListPageInner />
    </Suspense>
  );
}
