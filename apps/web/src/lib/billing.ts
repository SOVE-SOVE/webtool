import type { NextPaymentKind, NextPaymentObligation, NextPaymentSummary } from "./api";

export const NEXT_PAYMENT_KIND_LABEL: Record<NextPaymentKind, string> = {
  website_deposit: "Website deposit",
  website_balance: "Website balance",
  hosting_charge: "Monthly hosting",
  hosting_scheduled: "Monthly hosting (scheduled)",
};

export type NextPaymentStatus = "overdue" | "upcoming" | "no_due_date" | "none";

export type NextPaymentDisplay = {
  status: NextPaymentStatus;
  /** e.g. "Overdue by 3 days", "Due in 7 days", "Due today", "Multiple payments due", "Due date not set", "No upcoming payment scheduled". */
  headline: string;
  /** The obligation(s) the headline describes — empty for "no_due_date"/"none". */
  primary: NextPaymentObligation[];
  /** When overdue obligations exist, the next upcoming one too (shown separately, per spec). */
  secondaryUpcoming: NextPaymentObligation[] | null;
};

function pluralDays(n: number): string {
  return `${n} day${n === 1 ? "" : "s"}`;
}

/** e.g. "Overdue by 3 days", "Due today", "Due in 7 days", "Due date not set" — for one obligation row. */
export function relativeObligationLabel(o: NextPaymentObligation): string {
  if (o.due_date === null) return "Due date not set";
  if (o.days_relative === null) return o.due_date;
  if (o.is_overdue) return `Overdue by ${pluralDays(Math.abs(o.days_relative))}`;
  if (o.days_relative === 0) return "Due today";
  return `Due in ${pluralDays(o.days_relative)}`;
}

export type ObligationGroup = "overdue" | "due_today" | "next_7_days" | "later" | "no_due_date";

/**
 * Partitions a full (workspace-wide) obligation list into the Revenue
 * page's Upcoming & Overdue sections — overdue first, then due-today/
 * next-7-days/later, with no-due-date obligations kept separate since
 * they can't be placed on the timeline at all. Pure so it's directly
 * testable without a server round-trip.
 */
export function groupObligations(
  obligations: NextPaymentObligation[],
): Record<ObligationGroup, NextPaymentObligation[]> {
  const groups: Record<ObligationGroup, NextPaymentObligation[]> = {
    overdue: [],
    due_today: [],
    next_7_days: [],
    later: [],
    no_due_date: [],
  };
  for (const o of obligations) {
    if (o.due_date === null) {
      groups.no_due_date.push(o);
      continue;
    }
    if (o.is_overdue) {
      groups.overdue.push(o);
      continue;
    }
    const days = o.days_relative ?? 0;
    if (days === 0) groups.due_today.push(o);
    else if (days <= 7) groups.next_7_days.push(o);
    else groups.later.push(o);
  }
  const byDueDate = (a: NextPaymentObligation, b: NextPaymentObligation) =>
    (a.due_date ?? "").localeCompare(b.due_date ?? "");
  groups.overdue.sort(byDueDate);
  groups.next_7_days.sort(byDueDate);
  groups.later.sort(byDueDate);
  return groups;
}

/**
 * Pure derivation of what the "Next payment" widget should say, from
 * the server-computed `NextPaymentSummary` — kept out of the components
 * so the Overview snapshot and the Billing tab's full panel render
 * from identical logic, never two slightly-different summaries.
 */
export function describeNextPayment(summary: NextPaymentSummary): NextPaymentDisplay {
  if (summary.overdue.length > 0) {
    const headline =
      summary.overdue.length > 1
        ? "Multiple payments overdue"
        : `Overdue by ${pluralDays(Math.abs(summary.overdue[0].days_relative ?? 0))}`;
    return {
      status: "overdue",
      headline,
      primary: summary.overdue,
      secondaryUpcoming: summary.upcoming.length > 0 ? summary.upcoming : null,
    };
  }
  if (summary.upcoming.length > 0) {
    const days = summary.upcoming[0].days_relative ?? 0;
    const headline =
      summary.upcoming.length > 1 ? "Multiple payments due" : days === 0 ? "Due today" : `Due in ${pluralDays(days)}`;
    return { status: "upcoming", headline, primary: summary.upcoming, secondaryUpcoming: null };
  }
  if (summary.no_due_date_count > 0) {
    return { status: "no_due_date", headline: "Due date not set", primary: [], secondaryUpcoming: null };
  }
  return { status: "none", headline: "No upcoming payment scheduled", primary: [], secondaryUpcoming: null };
}
