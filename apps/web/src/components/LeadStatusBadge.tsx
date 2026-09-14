import type { LeadPriority, LeadStatus } from "@/lib/api";
import { LEAD_STATUS_LABEL, leadTone, type LeadTone } from "@/lib/leads";

// Five tones, not ten status colours — same restraint as ProjectStatusBadge.
const TONE_CLASS: Record<LeadTone, string> = {
  new: "bg-surface-subtle text-fg-muted",
  active: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  won: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  lost: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  nurture: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
};

export function LeadStatusBadge({
  status,
  className = "",
}: {
  status: LeadStatus;
  className?: string;
}) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${TONE_CLASS[leadTone(status)]} ${className}`}
    >
      {LEAD_STATUS_LABEL[status]}
    </span>
  );
}

// Only "high" gets an attention-grabbing colour — low/medium stay quiet so
// the one signal worth a glance ("this one's hot") doesn't get lost among
// ten evenly-weighted badges. Shared by the Leads table and board, and the
// Lead Detail header, so a priority reads identically everywhere.
export const LEAD_PRIORITY_STYLE: Record<LeadPriority, string> = {
  low: "bg-surface-subtle text-fg-muted",
  medium: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  high: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
};

export function LeadPriorityBadge({
  priority,
  score,
  className = "",
}: {
  priority: LeadPriority;
  score?: number | null;
  className?: string;
}) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${LEAD_PRIORITY_STYLE[priority]} ${className}`}
    >
      {priority}
      {score != null && ` · ${score}`}
    </span>
  );
}
