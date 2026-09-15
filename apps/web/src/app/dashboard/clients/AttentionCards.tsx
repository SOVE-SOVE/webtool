"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import {
  api,
  type ChecklistItem,
  type Project,
  type WebsiteFeedback,
} from "@/lib/api";
import { LIVE_STAGES } from "@/lib/filters";
import { NEXT_PAYMENT_KIND_LABEL } from "@/lib/billing";
import { formatDate, formatMoney } from "@/lib/format";
import { ThumbnailPlaceholder } from "@/components/ui/ThumbnailPlaceholder";
import type { AttentionCard, AttentionCardPayment } from "@/lib/clients";

const CARD_WIDTH_PX = 336; // w-80 (320px) + gap-4 (16px) — the scroll-by distance for the prev/next controls.
const DEFAULT_VISIBLE_PAYMENTS = 2;

function scrollByCards(el: HTMLDivElement, direction: 1 | -1) {
  const prefersReducedMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollBy({ left: direction * CARD_WIDTH_PX * 2, behavior: prefersReducedMotion ? "auto" : "smooth" });
}

function PaymentLine({ payment, billingHref }: { payment: AttentionCardPayment; billingHref: string }) {
  return (
    <Link href={billingHref} className="block rounded px-1.5 py-1 -mx-1.5 hover:bg-red-100/60 dark:hover:bg-red-500/10">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-fg">{NEXT_PAYMENT_KIND_LABEL[payment.kind]}</span>
        <span className="shrink-0 tabular-nums font-medium text-red-700 dark:text-red-400">
          {formatMoney(payment.amountCents)}
        </span>
      </div>
      <p className="truncate text-xs text-fg-muted">
        {payment.projectName}
        {payment.dueDate && ` · Due ${formatDate(payment.dueDate)}`} · Overdue by {payment.daysOverdue} day
        {payment.daysOverdue === 1 ? "" : "s"}
      </p>
    </Link>
  );
}

type ExpandedDetail = {
  loading: boolean;
  requiredItems: (ChecklistItem & { projectName: string | null })[];
  feedback: (WebsiteFeedback & { projectName: string })[];
  error: boolean;
};

function ExpandedDetailSection({ detail, tasksHref }: { detail: ExpandedDetail; tasksHref: string }) {
  if (detail.loading) {
    return (
      <div className="mt-2 space-y-1.5">
        <div className="h-3 w-3/4 animate-pulse rounded bg-surface-subtle motion-reduce:animate-none" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-surface-subtle motion-reduce:animate-none" />
      </div>
    );
  }
  if (detail.error) {
    return <p className="mt-2 text-xs text-fg-subtle">{"Couldn't load full details right now."}</p>;
  }
  return (
    <div className="mt-2 space-y-2">
      {detail.requiredItems.length > 0 && (
        <div>
          <p className="text-xs font-medium text-fg-subtle">Required tasks</p>
          <ul className="mt-1 space-y-1">
            {detail.requiredItems.map((item) => (
              <li key={item.id}>
                <Link href={tasksHref} className="block rounded px-1.5 py-1 -mx-1.5 hover:bg-red-100/60 dark:hover:bg-red-500/10">
                  <p className="truncate text-fg">
                    {item.title}
                    {item.projectName && <span className="text-fg-muted"> · {item.projectName}</span>}
                  </p>
                  <p className="truncate text-xs text-fg-muted">
                    {item.assigned_user_name ?? "Unassigned"}
                    {item.status === "blocked" && item.blocked_reason && ` · Blocked: ${item.blocked_reason}`}
                    {item.status === "blocked" && !item.blocked_reason && " · Blocked"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {detail.feedback.length > 0 && (
        <div>
          <p className="text-xs font-medium text-fg-subtle">Feedback awaiting review</p>
          <ul className="mt-1 space-y-1">
            {detail.feedback.map((f) => (
              <li key={f.id}>
                <Link
                  href={`/dashboard/projects/${f.project_id}`}
                  className="block rounded px-1.5 py-1 -mx-1.5 hover:bg-red-100/60 dark:hover:bg-red-500/10"
                >
                  <p className="truncate text-fg">{f.projectName}</p>
                  <p className="truncate text-xs text-fg-muted">{f.feedback_type.replace("_", " ")} · Open</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * The card's website preview — same treatment as the Build workspace's
 * PlanningCard/ProjectCard: no screenshot or thumbnail capability
 * exists anywhere in this codebase for a generated website, so this
 * always renders the shared ThumbnailPlaceholder, never a fabricated
 * image, with a label that only ever reflects a real signal (whether
 * any of this client's own projects has actually reached a live stage).
 */
function ClientAttentionPreview({ clientProjects }: { clientProjects: Project[] }) {
  const isLive = clientProjects.some((p) => LIVE_STAGES.includes(p.stage));
  return <ThumbnailPlaceholder label={isLive ? "Live website — no preview image" : "No preview image yet"} />;
}

/** Compact "⋯" secondary-actions menu — same shape as Build's CardMenu
 * (fixed overlay + absolute dropdown, shadow-lg panel) — every
 * reachable-but-not-primary shortcut for this card, kept out of the way
 * of the two primary navigation targets (business name, the bottom
 * "Open Client" action). */
function CardMenu({ card }: { card: AttentionCard }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`More actions for ${card.clientName}`}
        className="rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg"
      >
        ⋯
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 z-20 mt-1 w-44 rounded-md border border-border bg-surface py-1 shadow-lg">
            {card.clientId && (
              <Link href={`/dashboard/clients/${card.clientId}`} className="block px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover">
                Open Client
              </Link>
            )}
            <Link href={card.billingHref} className="block px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover">
              View Billing
            </Link>
            <Link href={card.tasksHref} className="block px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover">
              View Tasks
            </Link>
          </div>
        </>
      )}
    </span>
  );
}

function ClientAttentionCard({
  card,
  clientProjects,
}: {
  card: AttentionCard;
  clientProjects: Project[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<ExpandedDetail | null>(null);

  const hasMorePayments = card.payments.length > DEFAULT_VISIBLE_PAYMENTS;
  const canExpand = hasMorePayments || card.requiredTasksOutstanding > 0;
  const visiblePayments = expanded ? card.payments : card.payments.slice(0, DEFAULT_VISIBLE_PAYMENTS);
  const issueCount = card.payments.length + (card.requiredTasksOutstanding > 0 ? 1 : 0);
  const projectLabel =
    clientProjects.length === 0 ? null : clientProjects.length === 1 ? clientProjects[0].name : `${clientProjects.length} projects`;
  // No client page exists for a clientless (prospect) project's own
  // card — same "disabled, not a dead link" treatment the original
  // card used, preserved exactly rather than falling back to a
  // different destination.
  const clientHref = card.clientId ? `/dashboard/clients/${card.clientId}` : "#";

  const whyParts: string[] = [];
  if (card.payments.length > 0) {
    const total = card.payments.reduce((sum, p) => sum + p.amountCents, 0);
    whyParts.push(
      card.payments.length === 1
        ? `${formatMoney(card.payments[0].amountCents)} overdue by ${card.payments[0].daysOverdue} day${card.payments[0].daysOverdue === 1 ? "" : "s"}`
        : `${formatMoney(total)} overdue across ${card.payments.length} payments`,
    );
  }
  if (card.requiredTasksOutstanding > 0) {
    whyParts.push(`${card.requiredTasksOutstanding} required task${card.requiredTasksOutstanding === 1 ? "" : "s"} outstanding`);
  }

  async function handleShowAllItems() {
    const next = !expanded;
    setExpanded(next);
    // Full item-level detail (task titles/assignees/blocked reasons, and
    // any feedback awaiting review) is fetched only now, on explicit
    // expand of this one card — not for every card up front, which
    // would be exactly the slow per-row request pattern this section
    // avoids. Cached in local state so re-collapsing/re-expanding the
    // same card doesn't refetch.
    if (next && !detail && card.clientId) {
      setDetail({ loading: true, requiredItems: [], feedback: [], error: false });
      try {
        const [checklist, feedbackLists] = await Promise.all([
          card.requiredTasksOutstanding > 0 ? api.getClientChecklist(card.clientId) : Promise.resolve(null),
          Promise.all(
            clientProjects.map((p) =>
              api
                .listWebsiteFeedback(p.id)
                .then((rows) => rows.filter((f) => f.status === "open").map((f) => ({ ...f, projectName: p.name })))
                .catch(() => []),
            ),
          ),
        ]);
        // Two projects sharing the same default checklist template
        // produce items with identical titles — tag each with its own
        // project's name (client-level items get null) so the card
        // never shows what looks like the same task duplicated with no
        // way to tell them apart.
        const requiredItems = checklist
          ? [
              ...checklist.client_items.map((item) => ({ ...item, projectName: null })),
              ...checklist.projects.flatMap((section) =>
                section.items.map((item) => ({ ...item, projectName: section.project_name })),
              ),
            ].filter((item) => item.is_required && item.status !== "complete" && item.status !== "not_required")
          : [];
        setDetail({ loading: false, requiredItems, feedback: feedbackLists.flat(), error: false });
      } catch {
        setDetail({ loading: false, requiredItems: [], feedback: [], error: true });
      }
    }
  }

  return (
    <div className="flex h-full w-[85vw] max-w-80 shrink-0 snap-start flex-col overflow-hidden rounded-md border border-border bg-surface transition-colors hover:border-border-strong sm:w-80">
      <ClientAttentionPreview clientProjects={clientProjects} />
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <div className="flex items-start justify-between gap-1.5">
          <Link
            href={clientHref}
            className={`min-w-0 truncate font-medium text-fg ${card.clientId ? "hover:underline" : "pointer-events-none"}`}
            title={card.clientName}
          >
            {card.clientName}
          </Link>
          <CardMenu card={card} />
        </div>

        <p className="truncate text-xs text-fg-muted">{card.contact ?? "No contact on file"}</p>

        {projectLabel && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate rounded bg-surface-subtle px-1.5 py-0.5 text-[11px] font-medium text-fg-muted">
              {projectLabel}
            </span>
          </div>
        )}

        {/* Concise attention summary — same restrained "coloured text,
            no filled badge" treatment as the Build workspace's own
            per-card attention line (ProjectCard's projectAttentionReason). */}
        {whyParts.length > 0 && <p className="text-xs font-medium text-red-700 dark:text-red-400">{whyParts.join(" · ")}</p>}

        {visiblePayments.length > 0 && (
          <div className="mt-0.5 space-y-1">
            {visiblePayments.map((p) => (
              <PaymentLine key={p.key} payment={p} billingHref={card.billingHref} />
            ))}
          </div>
        )}

        {card.requiredTasksOutstanding > 0 && !expanded && (
          <Link href={card.tasksHref} className="-mx-1.5 flex items-center justify-between gap-2 rounded px-1.5 py-1 hover:bg-red-100/60 dark:hover:bg-red-500/10">
            <span className="text-fg">
              {card.requiredTasksOutstanding} required task{card.requiredTasksOutstanding === 1 ? "" : "s"} outstanding
            </span>
            <span className="shrink-0 text-xs text-fg-muted">View →</span>
          </Link>
        )}

        {expanded && detail && <ExpandedDetailSection detail={detail} tasksHref={card.tasksHref} />}

        {canExpand && (
          <button
            type="button"
            onClick={handleShowAllItems}
            className="text-left text-xs font-medium text-fg-muted hover:text-fg"
          >
            {expanded ? "Show fewer" : "View all issues"}
          </button>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <span className="shrink-0 text-[11px] text-fg-subtle">
            {issueCount} issue{issueCount === 1 ? "" : "s"}
          </span>
          <Link
            href={clientHref}
            className={`btn btn-secondary btn-sm shrink-0 ${card.clientId ? "" : "pointer-events-none opacity-50"}`}
          >
            Open Client →
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * "Needs attention" as a horizontal row of one card per client — see
 * buildAttentionCards for how every client's overdue payments and
 * outstanding required tasks are grouped into exactly one card each.
 * Prev/next controls and native scroll both act on the same contained
 * `overflow-x-auto` track, so this section can never cause horizontal
 * page overflow; nothing here auto-scrolls or rotates on its own.
 */
export function AttentionCards({ cards, projects }: { cards: AttentionCard[]; projects: Project[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  if (cards.length === 0) return null;

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-red-800 dark:text-red-300">Needs attention</p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-fg-muted">
            {cards.length} client{cards.length === 1 ? "" : "s"}
          </span>
          {cards.length > 2 && (
            <span className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => scrollRef.current && scrollByCards(scrollRef.current, -1)}
                aria-label="Scroll to previous clients"
                className="rounded border border-border-strong p-1 text-fg-muted hover:bg-surface-hover hover:text-fg"
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5" aria-hidden="true">
                  <path d="M10 3 5 8l5 5" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => scrollRef.current && scrollByCards(scrollRef.current, 1)}
                aria-label="Scroll to next clients"
                className="rounded border border-border-strong p-1 text-fg-muted hover:bg-surface-hover hover:text-fg"
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5" aria-hidden="true">
                  <path d="M6 3l5 5-5 5" />
                </svg>
              </button>
            </span>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        role="list"
        aria-label="Clients needing attention"
        className="mt-2 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-1 motion-reduce:scroll-auto"
      >
        {cards.map((card) => (
          <div role="listitem" key={card.key}>
            <ClientAttentionCard
              card={card}
              clientProjects={card.clientId ? projects.filter((p) => p.client_id === card.clientId) : []}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Skeleton matching the Build workspace's own card skeletons
 * (PlanningCardSkeleton/ProjectCardSkeleton) — same preview-image bar,
 * content bars, and footer shape — so the row's loading state already
 * reads as "this kind of card" before any data has arrived. */
export function AttentionCardsSkeleton() {
  return (
    <div className="mt-3 flex gap-3 overflow-x-hidden">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex w-80 shrink-0 flex-col overflow-hidden rounded-md border border-border bg-surface">
          <div className="skeleton aspect-[16/10] rounded-none" />
          <div className="flex flex-1 flex-col gap-2 p-3">
            <div className="skeleton h-4 w-2/3" />
            <div className="skeleton h-3 w-1/2" />
            <div className="skeleton h-3 w-3/4" />
            <div className="mt-auto flex items-center justify-between gap-2 pt-2">
              <div className="skeleton h-3 w-12" />
              <div className="skeleton h-7 w-24" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
