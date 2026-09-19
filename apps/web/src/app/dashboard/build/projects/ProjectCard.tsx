"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type Deployment, type Project, type ProjectChecklistSummary, type Task } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { LIVE_STAGES } from "@/lib/filters";
import { deadlineStatus } from "@/lib/projects";
import type { Density } from "@/lib/useDensity";
import { ProjectStatusBadge } from "@/components/ProjectStatusBadge";
import { ThumbnailPlaceholder } from "@/components/ui/ThumbnailPlaceholder";
import { liveNonMockDeployment } from "@/components/websites/WebsiteCard";
import { PROJECT_OWNER_LABEL, projectAttentionReason, projectCardAction, projectOwnerType } from "./lib";

// Deployments only ever exist once a project has actually reached the
// point a deployment can be created (modules/deployments/service.py
// refuses one before READY_TO_DEPLOY) — fetching them for every card
// regardless of stage would be a pointless request for the common case
// (most projects are still mid-build). No workspace-wide bulk endpoint
// exists for deployments (unlike checklist summaries), so this reuses
// WebsiteCard's own established per-project fetch, just bounded to the
// stages where it can possibly matter.
const DEPLOYMENT_RELEVANT_STAGES = ["ready_to_deploy", ...LIVE_STAGES];

/**
 * The card's website preview. No screenshot or thumbnail capability
 * exists anywhere in this codebase for a generated website (see
 * ThumbnailPlaceholder's own docstring) — this always renders the
 * shared placeholder, never a fabricated image, but distinguishes
 * "live", "a draft exists to review", and "nothing generated yet"
 * through its label, using only real signals (a genuine non-mock live
 * deployment, and where the project sits in its fixed stage sequence).
 */
function ProjectPreview({ project, liveUrl }: { project: Project; liveUrl: string | null }) {
  const label = liveUrl
    ? "Live website — no preview image"
    : LIVE_STAGES.includes(project.stage) || project.stage === "ready_to_deploy"
      ? "Deployed — no preview image"
      : project.stage === "intake" || project.stage === "research" || project.stage === "brief"
        ? "Not started yet"
        : "Draft — no preview image yet";
  return <ThumbnailPlaceholder label={label} />;
}

/** Compact "⋯" secondary-actions menu — every reachable-but-not-primary
 * shortcut for this card (the Client or source Lead it belongs to),
 * kept out of the way of the two primary navigation targets (project
 * name, primary action). */
function CardMenu({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const owner = projectOwnerType(project);
  return (
    <span className="relative inline-block shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`More actions for ${project.name}`}
        className="rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg"
      >
        ⋯
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="menu-panel absolute right-0 z-20 mt-1 w-44 rounded-md border border-border bg-surface py-1 shadow-lg">
            <Link href={`/dashboard/projects/${project.id}`} className="block px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover">
              Open Project
            </Link>
            {owner === "client" && project.client_id && (
              <Link href={`/dashboard/clients/${project.client_id}`} className="block px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover">
                Open Client
              </Link>
            )}
            {owner === "prospect" && project.source_lead_id && (
              <Link href={`/dashboard/leads/${project.source_lead_id}`} className="block px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover">
                Open Lead
              </Link>
            )}
            <Link
              href={`/dashboard/projects/${project.id}/website`}
              className="block px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover"
            >
              Open Preview
            </Link>
          </div>
        </>
      )}
    </span>
  );
}

export function ProjectCard({
  project,
  nextTask,
  checklist,
  density,
  flash,
}: {
  flash?: boolean;
  project: Project;
  nextTask: Task | null;
  checklist: ProjectChecklistSummary | undefined;
  density: Density;
}) {
  const [deployments, setDeployments] = useState<Deployment[] | null>(null);
  const fetchDeployments = DEPLOYMENT_RELEVANT_STAGES.includes(project.stage);

  useEffect(() => {
    if (!fetchDeployments) return;
    let cancelled = false;
    api
      .listDeployments(project.id)
      .then((rows) => {
        if (!cancelled) setDeployments(rows);
      })
      .catch(() => {
        if (!cancelled) setDeployments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, fetchDeployments]);

  const liveDeployment = deployments ? liveNonMockDeployment(deployments) : null;
  const hasFailedDeployment = deployments?.some((d) => d.status === "failed") ?? false;
  const owner = projectOwnerType(project);
  const action = projectCardAction(project, liveDeployment?.url ?? null);
  const attention = projectAttentionReason(project, checklist, hasFailedDeployment);
  const dl = deadlineStatus(project.deadline);
  const showBusinessName = project.name.trim().toLowerCase() !== project.client_business_name.trim().toLowerCase();
  const padY = density === "compact" ? "p-2.5" : "p-3";
  const href = `/dashboard/projects/${project.id}`;

  return (
    <div className={`card-interactive flex flex-col overflow-hidden rounded-md border border-border bg-surface hover:border-border-strong ${flash ? "row-flash" : ""}`}>
      <Link href={href} tabIndex={-1} aria-hidden="true">
        <ProjectPreview project={project} liveUrl={liveDeployment?.url ?? null} />
      </Link>
      <div className={`flex flex-1 flex-col gap-1.5 ${padY}`}>
        <div className="flex items-start justify-between gap-1.5">
          <Link href={href} title={project.name} className="min-w-0 truncate font-medium text-fg hover:underline">
            {project.name}
          </Link>
          <CardMenu project={project} />
        </div>

        {showBusinessName && <p className="truncate text-xs text-fg-muted">{project.client_business_name}</p>}

        <div className="flex flex-wrap items-center gap-1.5">
          <ProjectStatusBadge project={project} />
          <span className="rounded bg-surface-subtle px-1.5 py-0.5 text-[11px] font-medium text-fg-muted">
            {PROJECT_OWNER_LABEL[owner]}
          </span>
          {liveDeployment && (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
              Live
            </span>
          )}
        </div>

        {/* One line, highest-priority real signal only — never stacked
            with the status badge's own text (see projectAttentionReason). */}
        {attention && <p className="text-xs font-medium text-red-700 dark:text-red-400">{attention}</p>}

        {/* Checklist progress: omitted entirely (not a 0%) when the
            summary hasn't resolved yet, or genuinely has no items. Raw
            counts only — never phrased as "% approved" or "QA passed",
            since a complete checklist isn't itself a launch approval. */}
        {checklist && checklist.total > 0 && (
          <div className="mt-0.5">
            <div className="h-1 w-full overflow-hidden rounded-full bg-surface-subtle">
              <div className="h-full rounded-full bg-accent" style={{ width: `${checklist.pct ?? 0}%` }} />
            </div>
            <p className="mt-1 text-[11px] text-fg-muted">
              {checklist.completed}/{checklist.total} tasks
            </p>
          </div>
        )}

        {nextTask && (
          <p className="truncate text-xs text-fg-muted" title={nextTask.title}>
            <span className="text-fg-subtle">Next: </span>
            {nextTask.title}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <span className="min-w-0 shrink truncate text-[11px] text-fg-subtle">
            {timeAgo(project.updated_at)}
            {project.deadline && dl !== "overdue" && ` · Due ${new Date(project.deadline).toLocaleDateString()}`}
          </span>
          {action.external ? (
            <a
              href={action.href}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary btn-sm shrink-0"
            >
              {action.label}
            </a>
          ) : (
            <Link href={action.href} className="btn btn-secondary btn-sm shrink-0">
              {action.label}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/** Skeleton matching ProjectCard's own layout — shown while the list is
 * still loading, so the swap to real cards is a content change, not a
 * layout jump. */
export function ProjectCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-border bg-surface">
      <div className="skeleton aspect-[16/10] rounded-none" />
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="skeleton h-4 w-2/3" />
        <div className="skeleton h-3 w-1/2" />
        <div className="skeleton h-4 w-24" />
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <div className="skeleton h-3 w-12" />
          <div className="skeleton h-7 w-24" />
        </div>
      </div>
    </div>
  );
}
