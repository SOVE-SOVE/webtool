/**
 * Pure text summaries behind the two-sided Overview ClientCard — kept
 * out of the component so the "never invent, never pick arbitrarily"
 * rules are unit-testable. Every input here is data the Overview tab
 * already holds in memory for every row; nothing fetches.
 */
import type { NextPaymentObligation, Project, RevenueHostingPlan } from "../../../lib/api";
import { NEXT_PAYMENT_KIND_LABEL, relativeObligationLabel } from "../../../lib/billing";
import { CLIENT_STATUS_LABEL, type AttentionCard, type ClientTone } from "../../../lib/clients";
import { LIVE_STAGES } from "../../../lib/filters";
import { formatDate, formatMoney } from "../../../lib/format";
import { projectStatusLabel } from "../../../lib/projects";

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Acme Plumbing" → "AP", "Acme" → "AC" — the card's logo stand-in. Punctuation-only words ("—", "&") are skipped. */
export function clientInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w));
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** A dialable `tel:` href, or null when the stored value has no digits. */
export function telHref(phone: string): string | null {
  const dialable = phone.replace(/[^\d+]/g, "");
  return /\d/.test(dialable) ? `tel:${dialable}` : null;
}

export type CardAttentionItem = {
  /** Which of the client's tabs resolves this item — AttentionCard's own billingHref/tasksHref. */
  href: string;
  headline: string;
  detail: string | null;
  /** Issues behind this client's attention state that the headline doesn't cover. */
  moreCount: number;
};

/**
 * The one issue the card's front must show without flipping — same
 * precedence the old "Next:" line used (overdue payment first, then
 * outstanding required tasks), read from the same AttentionCard that
 * decides "Needs attention" membership so the two can never disagree.
 * Several overdue payments are summarised as one item, not one picked.
 */
export function topAttentionItem(attention: AttentionCard | null, currency: string): CardAttentionItem | null {
  if (!attention) return null;
  const { payments, requiredTasksOutstanding } = attention;
  if (payments.length > 0) {
    const moreCount = requiredTasksOutstanding > 0 ? 1 : 0;
    const oldest = Math.max(...payments.map((p) => p.daysOverdue));
    if (payments.length === 1) {
      const p = payments[0];
      return {
        href: attention.billingHref,
        headline: p.daysOverdue > 0 ? `Payment overdue by ${plural(p.daysOverdue, "day")}` : "Payment overdue",
        detail: `${formatMoney(p.amountCents, currency)} · ${NEXT_PAYMENT_KIND_LABEL[p.kind]}`,
        moreCount,
      };
    }
    const total = payments.reduce((sum, p) => sum + p.amountCents, 0);
    return {
      href: attention.billingHref,
      headline: `${payments.length} payments overdue`,
      detail: `${formatMoney(total, currency)} total${oldest > 0 ? ` · oldest ${plural(oldest, "day")}` : ""}`,
      moreCount,
    };
  }
  if (requiredTasksOutstanding > 0) {
    return {
      href: attention.tasksHref,
      headline: `${plural(requiredTasksOutstanding, "required task")} outstanding`,
      detail: null,
      moreCount: 0,
    };
  }
  return null;
}

export type PaymentLine = { tone: "overdue" | "upcoming" | "none"; primary: string; secondary: string };

/**
 * The back face's payment rows: an overdue balance and the next
 * upcoming payment are separate rows (both can be true at once), and
 * "nothing scheduled" is its own explicit state — never a blank.
 */
export function paymentLines(
  attention: AttentionCard | null,
  upcoming: NextPaymentObligation | null,
  currency: string,
): PaymentLine[] {
  const lines: PaymentLine[] = [];
  const overdue = attention?.payments ?? [];
  if (overdue.length > 0) {
    const total = overdue.reduce((sum, p) => sum + p.amountCents, 0);
    const oldest = Math.max(...overdue.map((p) => p.daysOverdue));
    lines.push({
      tone: "overdue",
      primary: `${formatMoney(total, currency)} overdue`,
      secondary:
        overdue.length === 1
          ? `${NEXT_PAYMENT_KIND_LABEL[overdue[0].kind]}${oldest > 0 ? ` · ${plural(oldest, "day")}` : ""}`
          : `${overdue.length} payments${oldest > 0 ? ` · oldest ${plural(oldest, "day")}` : ""}`,
    });
  }
  if (upcoming) {
    lines.push({
      tone: "upcoming",
      primary: `${formatMoney(upcoming.amount_cents, currency)}${upcoming.due_date ? ` · ${formatDate(upcoming.due_date)}` : ""}`,
      secondary: `${NEXT_PAYMENT_KIND_LABEL[upcoming.kind]} · ${relativeObligationLabel(upcoming)}`,
    });
  }
  if (lines.length === 0) {
    lines.push({ tone: "none", primary: "No payment scheduled", secondary: "" });
  }
  return lines;
}

/**
 * "3 projects · 2 live · 1 in progress" — the honest count for a client
 * with more than one project (null for zero or one, where the card names
 * the project itself instead). Live = LIVE_STAGES, the same split the
 * Overview's "N live" websites count already uses.
 */
export function projectCountSummary(projects: Pick<Project, "stage">[]): string | null {
  if (projects.length < 2) return null;
  const live = projects.filter((p) => LIVE_STAGES.includes(p.stage)).length;
  const inProgress = projects.length - live;
  return [
    plural(projects.length, "project"),
    live > 0 ? `${live} live` : null,
    inProgress > 0 ? `${inProgress} in progress` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "2 plans · 1 active · $50/mo" — for a client with more than one hosting plan. */
export function hostingPlansSummary(plans: Pick<RevenueHostingPlan, "status" | "monthly_fee_cents">[], currency: string): string {
  const active = plans.filter((p) => p.status === "active");
  const parts = [plural(plans.length, "plan"), `${active.length} active`];
  if (active.length > 0) {
    parts.push(`${formatMoney(active.reduce((sum, p) => sum + p.monthly_fee_cents, 0), currency)}/mo`);
  }
  return parts.join(" · ");
}

export type ClientCardBack = {
  /** CLIENT_STATUS_LABEL[tone] — the same status the front's badge shows. */
  statusLabel: string;
  /** One line on where the client's projects stand — never a single invented stage for several projects. */
  projectSummary: string;
  /** The single most important issue (when `attention`), else a quiet "No action needed". */
  message: string;
  attention: boolean;
};

export const NO_ACTION_NEEDED = "No action needed";

/**
 * The minimal back face: status, a project-state summary, and ONE next
 * action. The action follows topAttentionItem's precedence (overdue
 * payments, then outstanding required tasks) from the same AttentionCard
 * that decides "Needs attention" membership — so the back, the front's
 * attention block and the filter can never disagree — but it's one line,
 * never several stacked messages. The breakdown stays on the client page.
 */
export function clientCardBack(
  row: { tone: ClientTone; allProjects: Pick<Project, "name" | "stage" | "delivered_at">[] },
  attention: AttentionCard | null,
  currency: string,
): ClientCardBack {
  const { allProjects } = row;
  const projectSummary =
    allProjects.length === 0
      ? "No projects yet"
      : allProjects.length === 1
        ? `${allProjects[0].name} · ${projectStatusLabel(allProjects[0])}`
        : (projectCountSummary(allProjects) as string);

  const base = { statusLabel: CLIENT_STATUS_LABEL[row.tone], projectSummary };
  const top = topAttentionItem(attention, currency);
  if (!top || !attention) return { ...base, message: NO_ACTION_NEEDED, attention: false };

  const { payments } = attention;
  if (payments.length > 0) {
    const total = payments.reduce((sum, p) => sum + p.amountCents, 0);
    const amount = formatMoney(total, currency);
    return { ...base, message: `${top.headline} — ${payments.length > 1 ? `${amount} total` : amount}.`, attention: true };
  }
  return { ...base, message: `${top.headline}.`, attention: true };
}
