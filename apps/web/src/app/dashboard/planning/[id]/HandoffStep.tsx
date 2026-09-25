"use client";

import Link from "next/link";
import { useState } from "react";
import type { Lead, Planning, StageChecklist, User } from "@/lib/api";
import { StageChecklistBody } from "@/components/checklists/StageChecklistPanel";
import { NextActionSummary, progressLabel } from "@/components/checklists/TaskChecklistList";
import { ChevronDownIcon } from "@/components/ui/ControlIcons";
import { computeBuildBriefFacts } from "../lib";
import { StepFooter } from "./StepFooter";
import { computeBlueprintSummary } from "./websiteBlueprintLib";

type LeadBusinessFields = Pick<Lead, "industry" | "suburb" | "state" | "business_phone" | "business_email">;

/**
 * Step 5 — "Review & hand off". The brief summary is the same
 * `computeBuildBriefFacts` read Build Brief's own "Facts, Suggestions &
 * Open Questions" Disclosure already shows — recomputed from `planning`
 * on every render, never a second fetch. The outstanding-items summary
 * reuses the Planning checklist's own `progress`/`next_action` (lifted
 * to page.tsx via `useStageChecklist`) through the exact same
 * `progressLabel`/`NextActionSummary` render TaskChecklistList.tsx
 * already uses — not a re-derived summary. That same lifted checklist
 * state also backs a quiet "View checklist" toggle right below it (this
 * step is where the old always-visible "Planning checklist" panel used
 * to live at the top of the page) — reusing `StageChecklistBody` as-is
 * rather than re-rendering the checklist a second way, so viewing,
 * completing, and overriding items here is the exact same behaviour that
 * panel had. The Website Blueprint summary is likewise read straight off
 * `planning.blueprint_template`/`sitemap_pages`/`content_pages` via
 * `computeBlueprintSummary` — a plain count, never a new "readiness"
 * judgement. Handoff itself reuses the page's existing
 * `readyForHandoff`/`handleCreateProject` — this step never creates a
 * project on its own, and never gates navigation between steps on being
 * "ready".
 */
export function HandoffStep({
  planning,
  lead,
  checklist,
  checklistUsers,
  checklistError,
  onChecklistUpdated,
  readyForHandoff,
  creatingProject,
  createProjectError,
  createdProjectId,
  onCreateProject,
  onPrevious,
}: {
  planning: Planning;
  lead: LeadBusinessFields | null;
  checklist: StageChecklist | null;
  checklistUsers: User[];
  checklistError: string | null;
  onChecklistUpdated: (next: StageChecklist) => void;
  readyForHandoff: boolean;
  creatingProject: boolean;
  createProjectError: string | null;
  createdProjectId: string | null;
  onCreateProject: () => void;
  onPrevious: () => void;
}) {
  const summary = computeBuildBriefFacts(planning, lead);
  const blueprint = computeBlueprintSummary(planning);
  const [checklistOpen, setChecklistOpen] = useState(false);

  return (
    <div className="content-reveal space-y-5">
      <p className="text-sm text-fg-muted">Confirm everything below is ready, then hand this off to a project.</p>

      <section className="card p-4">
        <h2 className="section-title">Website Blueprint</h2>
        <div className="mt-2 space-y-1">
          <p className="text-sm text-fg">
            {blueprint.templateLabel ? `${blueprint.templateLabel} template applied` : "No starter template applied"}
          </p>
          <p className="text-sm text-fg-muted">
            {blueprint.pageCount === 0
              ? "No pages set up yet."
              : `${blueprint.pageCount} page${blueprint.pageCount === 1 ? "" : "s"}, ${blueprint.sectionCount} section${
                  blueprint.sectionCount === 1 ? "" : "s"
                } drafted.`}
          </p>
          {blueprint.pagesWithoutSections > 0 && (
            <p className="text-xs text-fg-subtle">
              {blueprint.pagesWithoutSections} page{blueprint.pagesWithoutSections === 1 ? "" : "s"} still {blueprint.pagesWithoutSections === 1 ? "has" : "have"} no sections.
            </p>
          )}
        </div>

        {/* The requirements board's own flat feature set — a completely
            separate list from the pages/sections above (see
            computeBlueprintSummary's own comment) shown here rather than
            as a second summary section, per this task's own instruction
            to extend the one function Handoff already reads. */}
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Website requirements</p>
          {blueprint.requirementCount === 0 ? (
            <p className="mt-1 text-sm text-fg-subtle">No features added yet — add some in “Prepare the website”.</p>
          ) : (
            <>
              <p className="mt-1 text-sm text-fg-muted">
                {blueprint.requirementCount} feature{blueprint.requirementCount === 1 ? "" : "s"} selected.
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {blueprint.requirementLabels.map((label) => (
                  <li key={label} className="rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-xs text-fg">
                    {label}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>

      <section className="card p-4">
        <h2 className="section-title">Brief summary</h2>
        <div className="mt-3 space-y-4">
          {summary.confirmedFacts.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Confirmed</p>
              <ul className="mt-1 space-y-1">
                {summary.confirmedFacts.map((f, i) => (
                  <li key={i} className="text-sm text-fg">
                    {f.fact} <span className="text-xs text-fg-subtle">({f.source})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {summary.proposedDecisions.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Proposed</p>
              <ul className="mt-1 space-y-1">
                {summary.proposedDecisions.map((d, i) => (
                  <li key={i} className="text-sm text-fg-muted">
                    {d}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {summary.openQuestions.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Open questions</p>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {summary.openQuestions.map((q, i) => (
                  <li key={i} className="text-sm text-fg">
                    {q}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {summary.confirmedFacts.length === 0 &&
            summary.proposedDecisions.length === 0 &&
            summary.openQuestions.length === 0 && (
              <p className="text-xs text-fg-subtle">Nothing to show yet — go back and generate a plan first.</p>
            )}
        </div>
      </section>

      <section className="card p-4">
        <h2 className="section-title">Outstanding required items</h2>
        {checklistError ? (
          <p className="mt-2 text-error">{checklistError}</p>
        ) : !checklist ? (
          <div className="mt-2 space-y-2">
            <div className="skeleton h-3 w-2/3" />
            <div className="skeleton h-3 w-1/2" />
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            <p className="text-sm text-fg-muted">{progressLabel(checklist.progress)}</p>
            <NextActionSummary nextAction={checklist.next_action} />
            {/* Quiet, link-style — this is the checklist's only remaining
                entry point in the UI (the always-visible panel that used
                to sit at the top of the page is gone), but it stays a
                small secondary control here rather than a second card. */}
            <button
              type="button"
              onClick={() => setChecklistOpen((v) => !v)}
              aria-expanded={checklistOpen}
              aria-controls="handoff-checklist-body"
              className="flex items-center gap-1 text-xs font-medium text-fg-muted hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              {checklistOpen ? "Hide checklist" : "View checklist"}
              <ChevronDownIcon
                aria-hidden="true"
                className={`h-3.5 w-3.5 transition-transform duration-fast ease-standard motion-reduce:transition-none ${
                  checklistOpen ? "rotate-180" : ""
                }`}
              />
            </button>
            {checklistOpen && (
              <div id="handoff-checklist-body" className="border-t border-border pt-3">
                <StageChecklistBody
                  ownerType="planning"
                  ownerId={planning.id}
                  checklist={checklist}
                  users={checklistUsers}
                  onUpdated={onChecklistUpdated}
                />
              </div>
            )}
          </div>
        )}
      </section>

      <section className="card p-4">
        <h2 className="section-title">Handoff readiness</h2>
        <p className="mt-1.5 text-sm text-fg-muted">
          {readyForHandoff
            ? "There's an audit or a generated website plan on file, and nothing is currently running — this workspace is ready to hand off to a project."
            : "Not ready yet — this needs either a completed website audit or a generated website plan, with no analysis currently in progress (see Review current presence)."}
        </p>
        {createProjectError && <p className="mt-2 text-error">{createProjectError}</p>}
      </section>

      {/* The step's "next action" — this is the last step, so it's the
          same reused Create project/Open project control the sticky
          header shows, not a "Continue" to a step that doesn't exist.
          Both read/write the same page-level state, so they can never
          disagree with each other. */}
      <StepFooter
        onPrevious={onPrevious}
        nextSlot={
          createdProjectId ? (
            <Link href={`/dashboard/projects/${createdProjectId}`} className="btn btn-primary btn-sm">
              Open project →
            </Link>
          ) : (
            <button
              type="button"
              onClick={onCreateProject}
              disabled={!readyForHandoff || creatingProject}
              className="btn btn-primary btn-sm"
            >
              {creatingProject ? "Creating…" : "Create project"}
            </button>
          )
        }
      />
    </div>
  );
}
