"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  api,
  PROJECT_STAGE_LABELS,
  PROJECT_STAGES,
  type Client,
  type Project,
  type ProjectChecklistSummary,
  type ProjectStage,
  type Task,
  type User,
} from "@/lib/api";
import { FINISHED_STAGES, filterProjects, UNASSIGNED } from "@/lib/filters";
import { nextOpenTask } from "@/lib/projects";
import { withParam } from "@/lib/url";
import { useDebouncedUrlSync } from "@/lib/useDebouncedUrlSync";
import { useScrollRestoration } from "@/lib/useScrollRestoration";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { PROJECT_OWNER_LABEL } from "./lib";
import { ProjectCard, ProjectCardSkeleton } from "./ProjectCard";
import { BuildSwitch } from "../BuildSwitch";
import { setLastBuildView } from "../lastView";

type SortKey = "updated" | "created" | "name";
const SORT_LABEL: Record<SortKey, string> = {
  updated: "Recently updated",
  created: "Recently created",
  name: "Project name (A–Z)",
};

const PAGE_SIZE = 24;
// Density is no longer user-togglable in the Build workspace (the
// Comfortable/Compact control's position now hosts the Planning/
// Projects switch instead) — a single fixed default replaces it, same
// padding ProjectCard already used for "comfortable".
const DENSITY = "comfortable" as const;

// useSearchParams() needs a Suspense-boundary ancestor for Next's static
// generation — see the default export below.
function ProjectsPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [checklists, setChecklists] = useState<ProjectChecklistSummary[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [clientId, setClientId] = useState("");
  const [name, setName] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [saving, setSaving] = useState(false);

  // Seeded once from the URL, then only ever written back one-
  // directionally via useDebouncedUrlSync — see leads/page.tsx's
  // `search` for the same reasoning.
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const [stageFilter, setStageFilter] = useState<ProjectStage | "">("");
  const [ownerFilter, setOwnerFilter] = useState<"" | "prospect" | "client">("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [showFinished, setShowFinished] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>("updated");
  const visibleCount = Math.max(PAGE_SIZE, Number(searchParams.get("show")) || PAGE_SIZE);

  useDebouncedUrlSync("search", search);

  // This view was the one the operator landed on — remembered so a bare
  // /dashboard/build visit (no explicit view) returns here next time.
  useEffect(() => {
    setLastBuildView("projects");
  }, []);

  function updateParam(key: string, value: string | null) {
    router.replace(`${pathname}?${withParam(searchParams, key, value)}`, { scroll: false });
  }

  function load() {
    api
      .listProjects()
      .then((rows) => {
        setError(null);
        setProjects(rows);
      })
      .catch(() => setError("Couldn't load projects."));
    api.listClients().then(setClients).catch(() => {});
    api.listUsers().then(setUsers).catch(() => {});
    api.listTasks().then(setTasks).catch(() => {});
    api.listProjectChecklistSummaries().then(setChecklists).catch(() => {}); // Progress is a nice-to-have per card — its own fetch failing shouldn't block the list.
  }

  useEffect(load, []);

  // The old "Live Websites" nav destination — this same list,
  // deep-linked as ?view=live — moved into the Clients workspace's
  // Websites tab (see docs/07_SESSION_LOG.md). Redirect old links
  // rather than rendering the now-removed live-only view here.
  useEffect(() => {
    if (searchParams.get("view") !== "live") return;
    const next = new URLSearchParams(searchParams.toString());
    next.delete("view");
    next.set("tab", "websites");
    router.replace(`/dashboard/clients?${next.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Deep-linked state (?new=1 from a quick action, ?stage=<x> from
  // Today's "ready to build" next action) — re-derived (not just seeded
  // once) so it stays correct if the URL changes without a remount.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setShowForm(searchParams.has("new"));
    const stage = searchParams.get("stage");
    setStageFilter(stage && (PROJECT_STAGES as readonly string[]).includes(stage) ? (stage as ProjectStage) : "");
    const owner = searchParams.get("owner");
    setOwnerFilter(owner === "prospect" || owner === "client" ? owner : "");
    setAssigneeFilter(searchParams.get("assignee") ?? "");
    setShowFinished(searchParams.has("finished"));
    const sort = searchParams.get("sort");
    setSortBy(sort === "created" || sort === "name" ? sort : "updated");
  }, [searchParams]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    sessionStorage.setItem("wdos-list-return:projects", `${pathname}?${searchParams.toString()}`);
  }, [pathname, searchParams]);

  useScrollRestoration(projects !== null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId) return;
    setSaving(true);
    try {
      const created = await api.createProject({
        client_id: clientId,
        name,
        assigned_user_id: assignedUserId || undefined,
      });
      // Land the user inside the new project rather than back on the list —
      // the detailed brief is an optional enrichment step from here, not a
      // barrier that had to be cleared before the project could exist.
      router.push(`/dashboard/projects/${created.id}?created=1`);
    } catch {
      setError("Couldn't create project.");
      setSaving(false);
    }
  }

  const checklistById = useMemo(() => {
    const map = new Map<string, ProjectChecklistSummary>();
    for (const c of checklists) map.set(c.project_id, c);
    return map;
  }, [checklists]);

  const activeCount = useMemo(
    () => (projects ? projects.filter((p) => !FINISHED_STAGES.includes(p.stage)).length : null),
    [projects],
  );

  const activeFilterCount = [search, stageFilter, ownerFilter, assigneeFilter].filter(Boolean).length;

  function clearFilters() {
    setSearch("");
    setStageFilter("");
    setOwnerFilter("");
    setAssigneeFilter("");
    let query = searchParams.toString();
    for (const key of ["search", "stage", "owner", "assignee"]) {
      query = withParam(new URLSearchParams(query), key, null);
    }
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }

  const visibleProjects = useMemo(() => {
    if (projects === null) return null;
    return filterProjects(projects, {
      search,
      stage: stageFilter,
      assignee: assigneeFilter,
      showFinished,
      ownerType: ownerFilter,
    }).sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "created") return a.created_at < b.created_at ? 1 : -1;
      return a.updated_at < b.updated_at ? 1 : -1;
    });
  }, [projects, search, stageFilter, ownerFilter, assigneeFilter, showFinished, sortBy]);

  const pagedProjects = visibleProjects?.slice(0, visibleCount) ?? null;

  const actions = (
    <div className="flex items-center gap-2">
      <BuildSwitch active="projects" />
      <button
        onClick={() => setShowForm((v) => !v)}
        disabled={clients.length === 0}
        className="btn btn-primary"
        title={clients.length === 0 ? "Convert a lead to a client first" : undefined}
      >
        {showForm ? "Cancel" : "New project"}
      </button>
    </div>
  );

  if (error) {
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="Build" actions={actions} />
        <div className="mt-4">
          <ErrorState message={error} onRetry={load} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader
        title="Build"
        description={
          activeCount === null
            ? "Websites in production for signed clients — where each one is, and what needs to happen next."
            : `${activeCount} active project${activeCount === 1 ? "" : "s"} — where each one is, and what needs to happen next.`
        }
        actions={actions}
      />

      {showForm && (
        <form onSubmit={handleCreate} className="max-w-xl space-y-3 rounded-md border border-border p-4">
          <select
            required
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="input"
          >
            <option value="">Select a client…</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.business_name}
              </option>
            ))}
          </select>
          <input
            required
            placeholder="Project name (e.g. “Riverside Plumbing Website”)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
          />
          <select value={assignedUserId} onChange={(e) => setAssignedUserId(e.target.value)} className="input">
            <option value="">Unassigned</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
          <button type="submit" disabled={saving} className="btn btn-primary">
            {saving ? "Saving…" : "Create project"}
          </button>
        </form>
      )}

      {projects === null ? null : projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description={
            clients.length === 0
              ? "Projects are for signed clients. Convert a won lead first (Leads → Won), or start one from Planning."
              : "Start a project for a client, or it's created automatically when you convert a won lead."
          }
          action={
            clients.length > 0 ? (
              <button onClick={() => setShowForm(true)} className="btn btn-primary">
                New project
              </button>
            ) : (
              <Link href="/dashboard/leads?tab=won" className="btn btn-primary">
                Go to Leads
              </Link>
            )
          }
        />
      ) : (
        <>
          {/* Search + filters, compact toolbar above the grid. */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              placeholder="Search project, business, package…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input w-56"
              aria-label="Search projects by project or business name"
            />
            <select
              value={stageFilter}
              onChange={(e) => {
                const next = e.target.value as ProjectStage | "";
                setStageFilter(next);
                updateParam("stage", next || null);
              }}
              className="input w-auto"
              aria-label="Filter by stage"
            >
              <option value="">All stages</option>
              {PROJECT_STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {PROJECT_STAGE_LABELS[stage]}
                </option>
              ))}
            </select>
            <select
              value={ownerFilter}
              onChange={(e) => {
                const next = e.target.value as "" | "prospect" | "client";
                setOwnerFilter(next);
                updateParam("owner", next || null);
              }}
              className="input w-auto"
              aria-label="Filter by prospect or client"
            >
              <option value="">Prospect or Client</option>
              <option value="prospect">{PROJECT_OWNER_LABEL.prospect}</option>
              <option value="client">{PROJECT_OWNER_LABEL.client}</option>
            </select>
            <select
              value={assigneeFilter}
              onChange={(e) => {
                setAssigneeFilter(e.target.value);
                updateParam("assignee", e.target.value || null);
              }}
              className="input w-auto"
              aria-label="Filter by assignee"
            >
              <option value="">Anyone assigned</option>
              <option value={UNASSIGNED}>Unassigned</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
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
                checked={showFinished}
                onChange={(e) => {
                  setShowFinished(e.target.checked);
                  updateParam("finished", e.target.checked ? "1" : null);
                }}
                disabled={stageFilter !== ""}
              />
              Show finished
            </label>
          </div>

          {visibleProjects && (
            <p className="text-xs text-fg-muted">
              {visibleProjects.length} of {projects.length} project{projects.length === 1 ? "" : "s"}
            </p>
          )}
        </>
      )}

      {projects === null && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <ProjectCardSkeleton key={i} />
          ))}
        </div>
      )}

      {pagedProjects && pagedProjects.length === 0 && projects && projects.length > 0 && (
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

      {pagedProjects && pagedProjects.length > 0 && (
        <>
          <div className="animate-fade-in grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
            {pagedProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                nextTask={nextOpenTask(tasks, project.id)}
                checklist={checklistById.get(project.id)}
                density={DENSITY}
              />
            ))}
          </div>

          {visibleProjects && visibleProjects.length > pagedProjects.length && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={() => updateParam("show", String(visibleCount + PAGE_SIZE))}
                className="btn btn-secondary btn-sm"
              >
                Load more ({visibleProjects.length - pagedProjects.length} remaining)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function ProjectsBuildView() {
  return (
    <Suspense fallback={<div className="p-4 sm:p-6" />}>
      <ProjectsPageInner />
    </Suspense>
  );
}
