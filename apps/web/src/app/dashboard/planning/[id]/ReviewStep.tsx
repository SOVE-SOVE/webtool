"use client";

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import {
  LIKED_ASPECT_LABELS,
  api,
  type Lead,
  type PlanningReference,
  type Planning,
  type Recommendation,
  type StageChecklist,
  type User,
} from "@/lib/api";
import { StageChecklistBody } from "@/components/checklists/StageChecklistPanel";
import { NextActionSummary, progressLabel } from "@/components/checklists/TaskChecklistList";
import { AnimatedHeight } from "@/components/ui/AnimatedHeight";
import { Badge } from "@/components/ui/Badge";
import { Disclosure } from "@/components/ui/Disclosure";
import { computeBuildBriefFacts } from "../lib";
import { BuildBriefTab } from "./BuildBriefTab";
import type { HandoffReadiness } from "./handoffReadiness";
import { StepFooter } from "./StepFooter";
import {
  REQUIREMENT_TEMPLATES,
  REQUIREMENT_TEMPLATE_LABEL,
  computeBlueprintSummary,
  computePlanSelectionSummary,
  computeRequirementEvidence,
  featureLabel,
  inferAppliedRequirementTemplate,
  recommendationFeatureKey,
} from "./websiteBlueprintLib";

type LeadBusinessFields = Pick<Lead, "industry" | "suburb" | "state" | "business_phone" | "business_email">;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const BLOCKERS_ID = "review-blockers";
// The brief's own open question for the same gap `essentialQuestion`
// covers (see computeBuildBriefFacts) — when it's listed, the essential
// question isn't added a second time.
const BRIEF_CONTACT_QUESTION = "No phone or email on file — confirm a primary contact method.";
const CREATE_NOTE_ID = "review-create-note";

/** An accepted feature recommendation whose feature isn't on the plan. */
function unplacedWarning(recommendation: Recommendation): string {
  const key = recommendationFeatureKey(recommendation);
  const feature = key ? featureLabel(key) : "its feature";
  return `“${recommendation.title}” was accepted earlier but ${feature} isn't on the plan.`;
}

/** Only the content draft states worth flagging — a running or approved
 * draft isn't something to check before creating the project. */
function contentDraftWarning(planning: Planning): string | null {
  if (planning.content_draft_status === "failed") return "The content draft failed to generate.";
  if (planning.content_draft_status === "needs_review") return "The content draft needs review.";
  return null;
}

/** One label/value row of the summary list. */
function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-xs font-semibold uppercase tracking-wide text-fg-muted sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 space-y-1.5 text-sm text-fg">{children}</dd>
    </div>
  );
}

/** One labelled group inside "Worth checking". */
function WarningGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{title}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/** Compact label chips for a summary row. */
function ChipList({ label, items }: { label: string; items: string[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={label}>
      {items.map((text) => (
        <li key={text} className="rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-xs text-fg">
          {text}
        </li>
      ))}
    </ul>
  );
}

const likedText = (ref: PlanningReference) => ref.liked_aspects.map((a) => LIKED_ASPECT_LABELS[a]).join(" · ");

/** A small preview of a reference's stored screenshot, or a neutral tile
 * when none was captured (or it fails to load). Decorative: the name
 * beside it carries the meaning. */
function InspirationThumb({ reference }: { reference: PlanningReference["reference"] }) {
  const [failed, setFailed] = useState(false);
  const tile = "aspect-[16/10] w-[4.5rem] shrink-0 overflow-hidden rounded border border-border bg-surface-subtle";
  if (!reference.has_screenshot || failed) {
    return (
      <span className={`${tile} flex items-center justify-center text-center text-xs leading-tight text-fg-subtle`}>
        No preview
      </span>
    );
  }
  return (
    <span className={`${tile} block`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- an authenticated API route, not an optimizable static asset */}
      <img
        src={api.websiteReferenceScreenshotUrl(reference)}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover object-top"
      />
    </span>
  );
}

/** Opens the original site; the new-tab behaviour is announced. */
function ReferenceLink({ reference, className }: { reference: PlanningReference["reference"]; className: string }) {
  return (
    <a
      href={reference.url}
      target="_blank"
      rel="noreferrer"
      className={`rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${className}`}
    >
      {reference.name}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-4">
      {items.map((text, i) => (
        <li key={i} className="text-sm text-fg">
          {text}
        </li>
      ))}
    </ul>
  );
}

/**
 * Step 3 — "Confirm & create project". One concise summary of what the
 * plan holds, then the conditions that actually stop "Create project"
 * (`readiness.blockers` — only the existing prerequisite rules, see
 * handoffReadiness.ts) kept apart from what's merely worth a look, then
 * the detailed evidence behind collapsed disclosures.
 *
 * Every value is read straight off `planning`/`checklist` on each render
 * through the existing helpers — no second fetch, no new readiness rule.
 * The Build Brief disclosure is controlled here (not the shared
 * Disclosure) only so the brief blocker's inline action can open it,
 * scroll it into view and move focus to it.
 *
 * Entering this step never creates anything: only the explicit "Create
 * project" button calls `onCreateProject` (the page's existing,
 * idempotent handoff), and once a project exists it becomes a plain
 * "Open project" link.
 */
export function ReviewStep({
  planning,
  lead,
  checklist,
  checklistUsers,
  checklistError,
  onChecklistUpdated,
  onUpdated,
  readiness,
  onBriefApproved,
  creatingProject,
  createProjectError,
  projectId,
  onCreateProject,
  onPrevious,
}: {
  planning: Planning;
  lead: LeadBusinessFields | null;
  checklist: StageChecklist | null;
  checklistUsers: User[];
  checklistError: string | null;
  onChecklistUpdated: (next: StageChecklist) => void;
  onUpdated: (p: Planning) => void;
  readiness: HandoffReadiness;
  onBriefApproved: () => void;
  creatingProject: boolean;
  createProjectError: string | null;
  projectId: string | null;
  onCreateProject: () => void;
  onPrevious: () => void;
}) {
  const brief = computeBuildBriefFacts(planning, lead);
  const blueprint = computeBlueprintSummary(planning);
  const selection = computePlanSelectionSummary(planning);
  const featureKeys = planning.blueprint_requirements.map((r) => r.feature_key);
  const template = inferAppliedRequirementTemplate(featureKeys);
  const templateText =
    featureKeys.length === 0 ? "No features chosen yet" : template ? `${REQUIREMENT_TEMPLATE_LABEL[template]} template` : "Custom selection";

  // "Essentials" are the Simple template's own defined set (its copy
  // calls them "the two essentials") — a warning only, never a gate.
  const selectedKeys = new Set(featureKeys);
  const missingEssentials = REQUIREMENT_TEMPLATES.simple.filter((key) => !selectedKeys.has(key)).map(featureLabel);
  // What's already on file per chosen feature (read-only, gathered
  // automatically) — carried into the summary so nothing is re-entered.
  const evidence = computeRequirementEvidence(planning, lead);
  const evidenceShown = evidence.filter((e) => e.known.length > 0 || e.contentNeeded !== null);
  const nothingOnFile = evidence
    .filter((e) => e.known.length === 0 && e.contentNeeded === null)
    .map((e) => featureLabel(e.featureKey));
  // At most one essential question exists (Contact); it joins the open
  // questions unless the brief already asks the same thing.
  const essentialQuestions = evidence
    .map((e) => e.essentialQuestion)
    .filter((q): q is string => q !== null && !brief.openQuestions.includes(BRIEF_CONTACT_QUESTION));
  const openQuestions = [...brief.openQuestions, ...essentialQuestions];
  // Real content a chosen feature can't be built without — a warning
  // only; blockers stay exactly `readiness.blockers`.
  const contentNeeded = evidence
    .filter((e) => e.contentNeeded !== null)
    .map((e) => `${featureLabel(e.featureKey)}: ${e.contentNeeded}`);
  const unplaced = selection.unplacedAccepted.map(unplacedWarning);
  const contentWarning = contentDraftWarning(planning);
  const unresolvedCount = openQuestions.length + unplaced.length;
  const checklistNeedsAttention = checklist !== null && checklist.next_action.kind !== "done";
  const hasWarnings =
    missingEssentials.length > 0 ||
    unresolvedCount > 0 ||
    contentNeeded.length > 0 ||
    contentWarning !== null ||
    checklistNeedsAttention;

  // Look-and-feel references attached to this plan — informational only,
  // never a blocker or a warning.
  const inspiration = [...(planning.inspiration_references ?? [])].sort((a, b) => a.order_index - b.order_index);

  const showBlockers = !projectId;
  const hasBlockers = showBlockers && readiness.blockers.length > 0;

  const [briefOpen, setBriefOpen] = useState(false);
  const briefToggleRef = useRef<HTMLButtonElement>(null);

  function openBriefForApproval() {
    setBriefOpen(true);
    // Next frame, so the disclosure has started opening before we move
    // the viewport to it; focus follows so keyboard users land there too.
    requestAnimationFrame(() => {
      const el = briefToggleRef.current;
      if (!el) return;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
      el.focus({ preventScroll: true });
      // Fallback for environments where smooth scrolling never runs
      // (throttled/background tabs): land on it instantly instead.
      window.setTimeout(() => {
        const { top, bottom } = el.getBoundingClientRect();
        if (top < 0 || bottom > window.innerHeight) el.scrollIntoView({ behavior: "auto", block: "start" });
      }, 700);
    });
  }

  return (
    <div className="content-reveal space-y-5">
      <p className="text-sm text-fg-muted">
        Check the plan, clear anything that&apos;s blocking, then create a project from it.
      </p>

      <section className="card p-4" aria-labelledby="review-summary-title">
        <h2 id="review-summary-title" className="section-title">
          Summary
        </h2>
        <dl className="mt-3 divide-y divide-border">
          <SummaryRow label="Website">
            <p>{templateText}</p>
            {selection.featureLabels.length > 0 && <ChipList label="Content sections" items={selection.featureLabels} />}
          </SummaryRow>

          {selection.capabilityLabels.length > 0 && (
            <SummaryRow label="Functionality">
              <ChipList label="Requested functionality" items={selection.capabilityLabels} />
              <p className="text-xs text-fg-subtle">Requested — needs building or connecting; nothing is set up yet.</p>
            </SummaryRow>
          )}

          {selection.designLabels.length > 0 && (
            <SummaryRow label="Design & behaviour">
              <ChipList label="Design and behaviour preferences" items={selection.designLabels} />
              <p className="text-xs text-fg-subtle">Preferences, not page sections.</p>
            </SummaryRow>
          )}

          <SummaryRow label="Site-wide">
            {selection.siteWideAccepted.length === 0 ? (
              <p className="text-fg-subtle">None accepted.</p>
            ) : (
              <p>{selection.siteWideAccepted.map((r) => r.title).join(" · ")}</p>
            )}
            {selection.siteWideProposed > 0 && (
              <p className="text-xs text-fg-muted">{selection.siteWideProposed} awaiting a decision</p>
            )}
          </SummaryRow>

          {inspiration.length > 0 && (
            <SummaryRow label="Inspiration">
              <ul className="space-y-2.5" aria-label="Inspiration references">
                {inspiration.map((ref) => (
                  <li key={ref.id} className="flex items-start gap-3">
                    {/* Mouse shortcut to the same site; the name link is the keyboard/screen-reader target. */}
                    <a href={ref.reference.url} target="_blank" rel="noreferrer" tabIndex={-1} aria-hidden="true">
                      <InspirationThumb reference={ref.reference} />
                    </a>
                    <div className="min-w-0 flex-1">
                      <ReferenceLink reference={ref.reference} className="text-sm font-medium text-fg hover:underline" />
                      {ref.liked_aspects.length > 0 && (
                        <p className="text-xs text-fg-muted">Liked: {likedText(ref)}</p>
                      )}
                      {ref.direction?.trim() && <p className="truncate text-xs text-fg-subtle">{ref.direction}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </SummaryRow>
          )}

          <SummaryRow label="Still open">
            {missingEssentials.length === 0 && unresolvedCount === 0 ? (
              <p className="text-fg-subtle">Nothing outstanding.</p>
            ) : (
              <p>
                {[
                  missingEssentials.length > 0 &&
                    `Missing ${missingEssentials.length === 1 ? "essential" : "essentials"}: ${missingEssentials.join(", ")}`,
                  unresolvedCount > 0 && plural(unresolvedCount, "unresolved question"),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </SummaryRow>
        </dl>
      </section>

      {showBlockers && (
        <section className="card p-4" aria-labelledby="review-blockers-title">
          <h2 id="review-blockers-title" className="section-title">
            Before you can create the project
          </h2>
          {hasBlockers ? (
            <ul id={BLOCKERS_ID} className="mt-2 space-y-2">
              {readiness.blockers.map((b) => (
                <li
                  key={b.id}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border border-border bg-surface-subtle px-3 py-2"
                >
                  <span className="flex min-w-0 items-start gap-2 text-sm text-fg">
                    <Badge tone="warning" className="shrink-0">
                      Required
                    </Badge>
                    <span className="min-w-0">{b.text}</span>
                  </span>
                  {b.id === "brief" && (
                    <button type="button" onClick={openBriefForApproval} className="btn btn-secondary btn-sm shrink-0">
                      Review Build Brief
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p id={BLOCKERS_ID} className="mt-1.5 text-sm text-fg-muted">
              {readiness.briefApproval === "unknown"
                ? "Nothing blocking here. Build Brief approval couldn't be checked, so it's confirmed when you create the project."
                : "Nothing blocking — this plan can become a project."}
            </p>
          )}
        </section>
      )}

      {hasWarnings && (
        <section className="card p-4" aria-labelledby="review-warnings-title">
          <h2 id="review-warnings-title" className="section-title">
            Worth checking <span className="font-normal text-fg-muted">(won&apos;t stop project creation)</span>
          </h2>
          <div className="mt-3 space-y-4">
            {missingEssentials.length > 0 && (
              <WarningGroup title="Missing essentials">
                <p className="text-sm text-fg">
                  {missingEssentials.join(" and ")} {missingEssentials.length === 1 ? "isn't" : "aren't"} on the plan.
                </p>
              </WarningGroup>
            )}
            {openQuestions.length > 0 && (
              <WarningGroup title="Open questions">
                <BulletList items={openQuestions} />
              </WarningGroup>
            )}
            {contentNeeded.length > 0 && (
              <WarningGroup title="Needs real content">
                <BulletList items={contentNeeded} />
              </WarningGroup>
            )}
            {unplaced.length > 0 && (
              <WarningGroup title="Accepted but not on the plan">
                <BulletList items={unplaced} />
              </WarningGroup>
            )}
            {contentWarning && (
              <WarningGroup title="Content draft">
                <p className="text-sm text-fg">{contentWarning}</p>
              </WarningGroup>
            )}
            {checklist && checklistNeedsAttention && (
              <WarningGroup title="Checklist">
                <div className="space-y-1.5">
                  <p className="text-sm text-fg-muted">{progressLabel(checklist.progress)}</p>
                  <NextActionSummary nextAction={checklist.next_action} />
                </div>
              </WarningGroup>
            )}
          </div>
        </section>
      )}

      <div className="space-y-3">
        <h2 className="section-title">Details</h2>

        {/* Controlled copy of the shared Disclosure's markup, so the brief
            blocker above can open it and move focus here. */}
        <div className="card">
          <button
            ref={briefToggleRef}
            type="button"
            onClick={() => setBriefOpen((o) => !o)}
            aria-expanded={briefOpen}
            aria-controls="review-brief-panel"
            className="flex w-full scroll-mt-4 items-center justify-between gap-3 rounded-[inherit] px-4 py-3 text-left transition-colors duration-fast ease-standard hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring motion-reduce:transition-none"
          >
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-sm font-medium text-fg">
                <span
                  aria-hidden="true"
                  className={`inline-block text-fg-subtle transition-transform duration-[var(--duration-fast)] ease-standard motion-reduce:transition-none ${briefOpen ? "rotate-90" : ""}`}
                >
                  ▸
                </span>
                Build Brief
              </span>
              <span className="mt-0.5 block truncate pl-4 text-xs text-fg-muted">
                Sitemap, visual direction, assets and approval
              </span>
            </span>
            {readiness.briefApproval === "approved" ? (
              <Badge tone="success" className="shrink-0">
                Approved
              </Badge>
            ) : readiness.briefApproval === "not_approved" ? (
              <Badge tone="warning" className="shrink-0">
                Not approved
              </Badge>
            ) : null}
          </button>
          <AnimatedHeight open={briefOpen}>
            <div id="review-brief-panel" className="border-t border-border p-4">
              <BuildBriefTab
                planning={planning}
                lead={lead}
                onUpdated={onUpdated}
                showRecommendations={false}
                onApproved={onBriefApproved}
              />
            </div>
          </AnimatedHeight>
        </div>

        <Disclosure title="Brief summary" hint="Pages, confirmed facts and proposed decisions">
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Pages</p>
              <p className="mt-1 text-sm text-fg">
                {blueprint.templateLabel ? `${blueprint.templateLabel} page layout` : "No starter page layout applied"}
                {" · "}
                {blueprint.pageCount === 0
                  ? "no pages set up yet"
                  : `${plural(blueprint.pageCount, "page")}, ${plural(blueprint.sectionCount, "section")} drafted`}
              </p>
              {blueprint.pagesWithoutSections > 0 && (
                <p className="mt-0.5 text-xs text-fg-subtle">
                  {blueprint.pagesWithoutSections} page{blueprint.pagesWithoutSections === 1 ? " still has" : "s still have"}{" "}
                  no sections.
                </p>
              )}
            </div>
            {brief.confirmedFacts.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Confirmed</p>
                <ul className="mt-1 space-y-1">
                  {brief.confirmedFacts.map((f, i) => (
                    <li key={i} className="text-sm text-fg">
                      {f.fact} <span className="text-xs text-fg-subtle">({f.source})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {brief.proposedDecisions.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Proposed</p>
                <ul className="mt-1 space-y-1">
                  {brief.proposedDecisions.map((d, i) => (
                    <li key={i} className="text-sm text-fg-muted">
                      {d}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {brief.confirmedFacts.length === 0 && brief.proposedDecisions.length === 0 && (
              <p className="text-xs text-fg-subtle">
                No confirmed facts or proposed decisions yet — run Analyse business first.
              </p>
            )}
          </div>
        </Disclosure>

        {evidence.length > 0 && (
          <Disclosure title="What's on file" hint="Gathered automatically for each chosen feature">
            <div className="space-y-3">
              {evidenceShown.map((e) => (
                <div key={e.featureKey}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{featureLabel(e.featureKey)}</p>
                  {e.known.length > 0 && (
                    <ul className="mt-1 space-y-1">
                      {e.known.map((item, i) => (
                        <li key={i} className="text-sm text-fg">
                          {item.text} <span className="text-xs text-fg-subtle">({item.source})</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {e.contentNeeded && (
                    <p className="mt-1 text-xs text-fg-subtle">
                      {e.known.length === 0 && "Nothing on file yet. "}Needs real content: {e.contentNeeded}
                    </p>
                  )}
                </div>
              ))}
              {nothingOnFile.length > 0 && (
                <p className="text-xs text-fg-subtle">Nothing on file yet for {nothingOnFile.join(", ")}.</p>
              )}
            </div>
          </Disclosure>
        )}

        {inspiration.length > 0 && (
          <Disclosure title="Inspiration references" hint={`${plural(inspiration.length, "site")} for look & feel`}>
            <div className="space-y-4">
              <div className="space-y-1 text-xs text-fg-subtle">
                <p>
                  Look &amp; feel inspiration only — not permission to copy text, branding, imagery or code.
                  Motion/interaction notes are the operator&apos;s own observations.
                </p>
                <p>
                  Included in the Build Brief and the project handoff as text (names, URLs, likes and direction).
                  Screenshots aren&apos;t sent to the AI.
                </p>
              </div>
              <ul className="space-y-3">
                {inspiration.map((ref) => (
                  <li key={ref.id} className="rounded-md border border-border bg-surface-subtle px-3 py-2.5">
                    <ReferenceLink reference={ref.reference} className="text-sm font-medium text-fg hover:underline" />
                    <p className="break-all text-xs text-fg-muted">{ref.reference.url}</p>
                    {ref.liked_aspects.length > 0 && (
                      <div className="mt-2">
                        <ChipList
                          label={`What's liked about ${ref.reference.name}`}
                          items={ref.liked_aspects.map((a) => LIKED_ASPECT_LABELS[a])}
                        />
                      </div>
                    )}
                    <p className="mt-2 whitespace-pre-line text-sm text-fg">
                      {ref.direction?.trim() || <span className="text-fg-subtle">No plan-specific direction noted.</span>}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </Disclosure>
        )}

        <Disclosure
          title="Checklist"
          hint={checklist ? progressLabel(checklist.progress) : "Planning tasks and who owns them"}
        >
          {checklistError ? (
            <p className="text-error">{checklistError}</p>
          ) : !checklist ? (
            <div className="space-y-2">
              <div className="skeleton h-3 w-2/3" />
              <div className="skeleton h-3 w-1/2" />
            </div>
          ) : (
            <StageChecklistBody
              ownerType="planning"
              ownerId={planning.id}
              checklist={checklist}
              users={checklistUsers}
              onUpdated={onChecklistUpdated}
            />
          )}
        </Disclosure>
      </div>

      <div className="space-y-1.5">
        <p id={CREATE_NOTE_ID} className="text-xs text-fg-muted">
          {projectId
            ? "A project has already been created from this plan."
            : "Creates a project record from this plan. It doesn't generate or publish a website, or connect any integrations."}
        </p>
        {createProjectError && (
          <p role="alert" className="text-error">
            {createProjectError}
          </p>
        )}
      </div>

      {/* The last step, so the footer's next action is the handoff
          itself — the same page-level state the sticky header's
          Create/Open project control reads, so the two never disagree. */}
      <StepFooter
        onPrevious={onPrevious}
        nextSlot={
          projectId ? (
            <Link href={`/dashboard/projects/${projectId}`} className="btn btn-primary btn-sm">
              Open project →
            </Link>
          ) : (
            <button
              type="button"
              onClick={onCreateProject}
              disabled={!readiness.canCreate || creatingProject}
              aria-describedby={`${BLOCKERS_ID} ${CREATE_NOTE_ID}`}
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
