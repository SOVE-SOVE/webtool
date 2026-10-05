"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";
import { api, type Deployment, type Project, type ProjectChecklistSummary, type Task } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { LIVE_STAGES } from "@/lib/filters";
import { deadlineStatus } from "@/lib/projects";
import type { Density } from "@/lib/useDensity";
import { ProjectStatusBadge } from "@/components/ProjectStatusBadge";
import { ThumbnailPlaceholder } from "@/components/ui/ThumbnailPlaceholder";
import { liveNonMockDeployment } from "@/components/websites/WebsiteCard";
import { PROJECT_OWNER_LABEL, projectAttentionReason, projectCardAction, projectOwnerType } from "./lib";
// The Clients Overview card's flip, reused as-is (as Build → Planning
// does): the same hover delay, leave grace, Details/Back rules,
// reduced-motion swap and timer cleanup.
import { faceExposure, FLIP_MS } from "@/app/dashboard/clients/cardFlip";
import { useCardFlip } from "@/app/dashboard/clients/useCardFlip";
import { projectCardBack } from "./projectCardBack";
import { Tooltip } from "@/components/ui/Tooltip";

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
 * name, primary action). Controlled by the card, which must know it's
 * open (an open menu blocks the flip). */
function CardMenu({
  project,
  open,
  onOpenChange: setOpen,
}: {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const owner = projectOwnerType(project);
  const rootRef = useRef<HTMLSpanElement>(null);
  // An outside press closes it. A document listener, not a fixed
  // full-screen click-catcher: the card is now a 3D context, which would
  // anchor a `position: fixed` catcher to the card instead of the viewport.
  // As with that catcher, the press that closes the menu does nothing
  // else: its click is swallowed, so it can't open another card's link.
  // Subscribed only while open, not re-subscribed on every card render: a
  // re-subscribe still pending when the next press arrives would swap the
  // listener mid-dispatch and miss that press.
  const close = useEffectEvent(() => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && rootRef.current?.contains(e.target)) return;
      close();
      const swallow = (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        clear();
      };
      // No click follows a drag or a cancelled press, so the next press or
      // key press drops a swallow that's still waiting. (Added during this
      // press's bubble phase, so this press itself doesn't trigger them.)
      const clear = () => {
        document.removeEventListener("click", swallow, { capture: true });
        document.removeEventListener("pointerdown", clear, { capture: true });
        document.removeEventListener("keydown", clear, { capture: true });
      };
      document.addEventListener("click", swallow, { capture: true });
      document.addEventListener("pointerdown", clear, { capture: true });
      document.addEventListener("keydown", clear, { capture: true });
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);
  return (
    <span ref={rootRef} className="relative inline-block shrink-0">
      <Tooltip label="More actions">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-haspopup="true"
          aria-expanded={open}
          aria-label={`More actions for ${project.name}`}
          className="rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg"
        >
          ⋯
        </button>
      </Tooltip>
      {open && (
        <>
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

/** Details/Back share one spot — the card's top-right corner — so flipping and flipping back is one repeated click. Solid (btn-secondary) so it stays legible over the preview; the hit area grows to 44px tall, inside the face. Same as PlanningCard's. */
const TOGGLE = "btn btn-secondary btn-sm absolute right-2.5 top-2.5 z-10 shadow-sm after:absolute after:inset-x-0 after:-inset-y-2.5";

function FlipToggle({
  label,
  ariaLabel,
  toggleRef,
  onToggle,
}: {
  label: string;
  ariaLabel: string;
  toggleRef: RefObject<HTMLButtonElement | null>;
  onToggle: () => void;
}) {
  return (
    <button ref={toggleRef} type="button" onClick={onToggle} aria-label={ariaLabel} className={TOGGLE}>
      {label}
    </button>
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
  // Derived from data already on the page — the list row, the bulk
  // checklist summary and the deployments fetched above. Nothing is
  // fetched to flip.
  const back = projectCardBack(project, checklist, deployments);

  const flip = useCardFlip();
  const [menuOpen, setMenuOpenState] = useState(false);
  function setMenuOpen(open: boolean) {
    setMenuOpenState(open);
    flip.setMenuOpen(open);
  }

  // As on ClientCard/PlanningCard: an explicit Details/Back makes the
  // pressed toggle inert, so focus moves to the other face's toggle
  // rather than being dropped on the page. Hover flips never move focus.
  const detailsRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const focusAfterFlip = useRef(false);
  const flipped = flip.face === "back";
  useEffect(() => {
    if (!focusAfterFlip.current) return;
    focusAfterFlip.current = false;
    (flipped ? backRef : detailsRef).current?.focus();
  }, [flipped]);

  // A filter, sort or "Load more" can move this card out from under a
  // resting pointer without any pointer event firing, which would leave
  // its hover timer running and flip a card nobody is pointing at. So
  // after any re-render while hovered, re-check the real :hover state —
  // once the grid's 200ms glide to the new position (useLayoutFlip on the
  // page) is over, since mid-glide the card can still be under the pointer.
  const rootRef = useRef<HTMLDivElement>(null);
  const { hovered, pointerLeft } = flip;
  useEffect(() => {
    if (!hovered) return;
    const id = setTimeout(() => {
      if (rootRef.current && !rootRef.current.matches(":hover")) pointerLeft();
    }, 250);
    return () => clearTimeout(id);
  });

  const frontExposure = faceExposure(!flipped, flip.moving);
  const backExposure = faceExposure(flipped, flip.moving);
  // Each face clips itself — clipping on the preserve-3d rotor would
  // flatten the 3D context (see ClientCard).
  const faceBase = "overflow-hidden rounded-md border border-border bg-surface backface-hidden hover:border-border-strong";

  return (
    // Static outer box: owns the grid cell and the pointer/focus handlers
    // and never moves. The front stays in normal flow, so its own content
    // still sizes the cell exactly as before; the back is laid over it at
    // the same size, so flipping never reflows the grid.
    <div
      ref={rootRef}
      data-flipped={flipped}
      className={`relative ${flip.moving ? "z-10" : ""}`}
      {...flip.pointerHandlers}
      {...flip.focusHandlers}
    >
      <div className="h-full perspective-distant">
        <div
          style={flip.reducedMotion ? undefined : { transitionDuration: `${FLIP_MS}ms` }}
          className={`relative h-full transform-3d ${flipped ? "rotate-y-180" : ""} ${
            flip.reducedMotion ? "" : "transition-transform ease-standard motion-reduce:transition-none"
          }`}
        >
          {/* Front — unchanged apart from the Details toggle laid over the preview. */}
          <div
            role="group"
            aria-label={`${project.name} — summary`}
            inert={frontExposure.inert}
            aria-hidden={frontExposure.ariaHidden || undefined}
            className={`card-interactive flex h-full flex-col ${faceBase} ${flash ? "row-flash" : ""} ${frontExposure.invisible ? "invisible" : ""}`}
          >
            <div className="relative">
              <Link href={href} tabIndex={-1} aria-hidden="true">
                <ProjectPreview project={project} liveUrl={liveDeployment?.url ?? null} />
              </Link>
              <FlipToggle
                label="Details"
                ariaLabel={`Show details for ${project.name}`}
                toggleRef={detailsRef}
                onToggle={() => {
                  focusAfterFlip.current = true;
                  flip.showDetails();
                }}
              />
            </div>
            <div className={`flex flex-1 flex-col gap-1.5 ${padY}`}>
              <div className="flex items-start justify-between gap-1.5">
                <Link href={href} title={project.name} className="min-w-0 truncate font-medium text-fg hover:underline">
                  {project.name}
                </Link>
                <CardMenu project={project} open={menuOpen} onOpenChange={setMenuOpen} />
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

          {/* Back — deliberately minimal: which project, its stage, one next action, one way in. */}
          <div
            role="group"
            aria-label={`${project.name} — next step`}
            inert={backExposure.inert}
            aria-hidden={backExposure.ariaHidden || undefined}
            className={`absolute inset-0 flex rotate-y-180 flex-col px-3 pb-3 pt-2.5 ${faceBase} ${backExposure.invisible ? "invisible" : ""}`}
          >
            {/* Up to two lines (project names run long), clear of the Back toggle. */}
            <p className="line-clamp-2 break-words py-0.5 pr-16 text-xs font-medium leading-5 text-fg-muted" title={back.name}>
              {back.name}
            </p>
            <FlipToggle
              label="Back"
              ariaLabel={`Back to summary for ${project.name}`}
              toggleRef={backRef}
              onToggle={() => {
                focusAfterFlip.current = true;
                flip.showFront();
              }}
            />
            {/* Scrolls only as a safety net, so unusually long copy is never clipped unreadably. */}
            <dl className="-mx-1 mt-3 min-h-0 flex-1 overflow-y-auto px-1">
              {back.stageLabel && (
                <>
                  <dt className="text-xs text-fg-muted">Current stage</dt>
                  <dd className="mt-0.5 text-base font-semibold leading-snug text-fg">{back.stageLabel}</dd>
                </>
              )}
              <dt className={`text-xs text-fg-muted ${back.stageLabel ? "mt-4" : ""}`}>{back.attention ? "Needs attention" : "Next"}</dt>
              <dd className={`mt-0.5 break-words text-sm leading-5 ${back.attention ? "font-medium text-red-700 dark:text-red-400" : "text-fg"}`}>
                {back.message}
              </dd>
            </dl>
            <div className="flex shrink-0 justify-end pt-2">
              {/* Named per project (the visible text stays inside the name), since every card has one. */}
              <Link
                href={back.href}
                aria-label={`${back.cta.replace(" →", "")} — ${project.name}`}
                className="btn btn-primary btn-sm relative shrink-0 after:absolute after:inset-x-0 after:-inset-y-2.5"
              >
                {back.cta}
              </Link>
            </div>
          </div>
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
