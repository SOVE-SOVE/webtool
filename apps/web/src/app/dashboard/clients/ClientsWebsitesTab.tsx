"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, type Project, type Task, type User } from "@/lib/api";
import { filterProjects, UNASSIGNED } from "@/lib/filters";
import { nextOpenTask } from "@/lib/projects";
import { withParam } from "@/lib/url";
import { useDebouncedUrlSync } from "@/lib/useDebouncedUrlSync";
import { useScrollRestoration } from "@/lib/useScrollRestoration";
import { CommandBar } from "@/components/ui/CommandBar";
import { CompactSelect } from "@/components/ui/CompactSelect";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { FilterChips } from "@/components/ui/FilterChips";
import { FilterField, FilterPopover } from "@/components/ui/FilterPopover";
import { SearchInput } from "@/components/ui/SearchInput";
import { Skeleton } from "@/components/ui/Skeleton";
import { WebsiteCard } from "@/components/websites/WebsiteCard";

/**
 * The Clients workspace's Websites tab — the former standalone "Live
 * Websites" nav destination (Projects filtered to `LIVE_STAGES` via
 * `filterProjects`'s `onlyLive`, same pure function/tests, just called
 * from here instead), enriched with each project's deployment/hosting
 * status via the shared `WebsiteCard`. A clientless (prospect) project
 * that's somehow reached a live stage is never hidden — `WebsiteCard`
 * shows "No client (prospect)" plus a link to the source Lead instead.
 */
export function ClientsWebsitesTab({ currency }: { currency: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [projects, setProjects] = useState<Project[] | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const [assigneeFilter, setAssigneeFilter] = useState("");

  useDebouncedUrlSync("search", search);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setAssigneeFilter(searchParams.get("assignee") ?? "");
  }, [searchParams]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function updateParam(key: string, value: string | null) {
    router.replace(`${pathname}?${withParam(searchParams, key, value)}`, { scroll: false });
  }

  // One replace() for search + assignee, so neither is left behind in the URL.
  function clearFilters() {
    setSearch("");
    setAssigneeFilter("");
    const params = new URLSearchParams(searchParams.toString());
    params.delete("search");
    params.delete("assignee");
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }

  function load() {
    api
      .listProjects()
      .then((rows) => {
        setError(null);
        setProjects(rows);
      })
      .catch(() => setError("Couldn't load websites."));
    api.listUsers().then(setUsers).catch(() => {});
    api.listTasks().then(setTasks).catch(() => {});
  }

  useEffect(load, []);

  useScrollRestoration(projects !== null);

  const visible = useMemo(
    () =>
      projects === null
        ? null
        : filterProjects(projects, { search, stage: "", assignee: assigneeFilter, showFinished: false, onlyLive: true }),
    [projects, search, assigneeFilter],
  );

  return (
    <div>
      <CommandBar
        search={
          <SearchInput
            placeholder="Search website, client, package…"
            aria-label="Search websites"
            value={search}
            onValueChange={setSearch}
          />
        }
        filters={
          <FilterPopover activeCount={assigneeFilter ? 1 : 0} onClearAll={clearFilters}>
            <FilterField label="Assigned to">
              <CompactSelect
                aria-label="Filter by assignee"
                value={assigneeFilter}
                onValueChange={(next) => {
                  setAssigneeFilter(next);
                  updateParam("assignee", next || null);
                }}
                options={[
                  { value: "", label: "Anyone assigned" },
                  { value: UNASSIGNED, label: "Unassigned" },
                  ...users.map((user) => ({ value: user.id, label: user.name })),
                ]}
              />
            </FilterField>
          </FilterPopover>
        }
        chips={
          assigneeFilter ? (
            <FilterChips
              chips={[
                {
                  id: "assignee",
                  label: "Assigned to",
                  value:
                    assigneeFilter === UNASSIGNED ? "Unassigned" : (users.find((u) => u.id === assigneeFilter)?.name ?? "Unknown"),
                  onRemove: () => {
                    setAssigneeFilter("");
                    updateParam("assignee", null);
                  },
                },
              ]}
              onClearAll={clearFilters}
            />
          ) : undefined
        }
      />

      {error && (
        <div className="mt-4">
          <ErrorState message={error} onRetry={load} compact />
        </div>
      )}

      {!projects && !error && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-md border border-border bg-surface p-4">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-3 h-24 w-full" />
              <Skeleton className="mt-3 h-4 w-2/3" />
            </div>
          ))}
        </div>
      )}

      {/* One wrapper for both branches below, mounted once `visible` first
          exists — so typing a search that narrows results to zero (and
          back) re-renders in place instead of replaying the reveal. */}
      {visible && (
        <div className="content-reveal">
          {projects && projects.length > 0 && visible.length === 0 && (
            <div className="mt-4">
              <EmptyState
                title="No live websites yet"
                description="Nothing has been deployed for a client yet — once a project ships, it shows up here."
              />
            </div>
          )}

          {visible.length > 0 && (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((project) => (
                <WebsiteCard
                  key={project.id}
                  project={project}
                  currency={currency}
                  nextTask={nextOpenTask(tasks, project.id)}
                  showClient
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
