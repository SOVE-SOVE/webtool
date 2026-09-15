"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, PROJECT_STAGE_LABELS, type Deployment, type HostingPlan, type Project, type Task } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { LIVE_STAGES } from "@/lib/filters";
import { ProjectStatusBadge } from "@/components/ProjectStatusBadge";
import { ThumbnailPlaceholder } from "@/components/ui/ThumbnailPlaceholder";

export const HOSTING_STATUS_LABEL: Record<HostingPlan["status"], string> = {
  active: "Active",
  paused: "Paused",
  cancelled: "Cancelled",
};

export function liveNonMockDeployment(deployments: Deployment[]): Deployment | null {
  const candidates = deployments
    .filter((d) => d.status === "success" && d.target !== "mock" && d.url)
    .sort((a, b) => ((a.completed_at ?? a.created_at) < (b.completed_at ?? b.created_at) ? 1 : -1));
  return candidates[0] ?? null;
}

/**
 * One project's website card — deployment/live status, hosting status,
 * and the standard Open/Visit/Preview actions. Shared by the Client
 * detail page's own Projects & Websites tab (client already known from
 * context, `showClient` left false) and the workspace-wide Clients →
 * Websites tab (`showClient` true, since rows there span every client).
 * Deliberately shows nothing it can't back with a real record — no
 * monitoring/uptime/maintenance data exists anywhere in this app, so
 * this never fabricates any.
 */
export function WebsiteCard({
  project,
  currency,
  nextTask = null,
  showClient = false,
}: {
  project: Project;
  currency: string;
  /** A maintenance/follow-up task for this project, if one already exists — never invented. */
  nextTask?: Task | null;
  showClient?: boolean;
}) {
  const [deployments, setDeployments] = useState<Deployment[] | null>(null);
  const [hostingPlans, setHostingPlans] = useState<HostingPlan[] | null>(null);

  useEffect(() => {
    api.listDeployments(project.id).then(setDeployments).catch(() => setDeployments([]));
    api.listHostingPlans(project.id).then(setHostingPlans).catch(() => setHostingPlans([]));
  }, [project.id]);

  const liveDeployment = deployments ? liveNonMockDeployment(deployments) : null;
  const activeHostingPlan = hostingPlans?.find((p) => p.status === "active") ?? hostingPlans?.[0] ?? null;
  const isLive = LIVE_STAGES.includes(project.stage);

  return (
    <div className="flex flex-col rounded-md border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <ProjectStatusBadge project={project} />
        {isLive && (
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
            Live
          </span>
        )}
      </div>

      <ThumbnailPlaceholder label={project.name} className="mt-2" />

      {showClient && (
        <p className="mt-2 truncate text-xs text-fg-muted">
          {project.client_id ? (
            <Link href={`/dashboard/clients/${project.client_id}`} className="hover:underline">
              {project.client_business_name}
            </Link>
          ) : project.source_lead_id ? (
            <>
              No client (prospect) —{" "}
              <Link href={`/dashboard/leads/${project.source_lead_id}`} className="hover:underline">
                from lead
              </Link>
            </>
          ) : (
            "No client (prospect)"
          )}
        </p>
      )}

      <p className={`truncate font-medium text-fg ${showClient ? "mt-0.5" : "mt-2"}`}>
        {project.name}
        {!showClient && project.source_lead_id && (
          <Link href={`/dashboard/leads/${project.source_lead_id}`} className="ml-2 text-xs font-normal text-fg-muted hover:underline">
            from lead
          </Link>
        )}
      </p>
      <p className="text-xs text-fg-muted">Build: {PROJECT_STAGE_LABELS[project.stage]}</p>
      {activeHostingPlan && (
        <p className="text-xs text-fg-muted">
          Hosting: {HOSTING_STATUS_LABEL[activeHostingPlan.status]}
          {activeHostingPlan.status === "active" && ` · ${formatMoney(activeHostingPlan.monthly_fee_cents, currency)}/mo`}
        </p>
      )}
      {nextTask && (
        <p className="mt-1 min-w-0 truncate text-xs text-fg-muted">
          <span className="text-fg-subtle">Next: </span>
          {nextTask.title}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-2 text-xs">
        <Link href={`/dashboard/projects/${project.id}`} className="btn btn-secondary btn-sm">
          Open Project
        </Link>
        {/* A "mock" deployment target is never rendered as a real,
            clickable link elsewhere in this app (see DeploymentPanel) —
            this respects the same guard rather than implying a fake
            site is really live. */}
        {liveDeployment?.url && (
          <a href={liveDeployment.url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
            Visit Website
          </a>
        )}
        <Link href={`/dashboard/projects/${project.id}/website`} className="btn btn-secondary btn-sm">
          Preview
        </Link>
      </div>
    </div>
  );
}
