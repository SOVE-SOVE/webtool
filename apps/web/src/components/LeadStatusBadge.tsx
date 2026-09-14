import type { LeadPriority, LeadStatus } from "@/lib/api";
import { LEAD_STATUS_LABEL, leadTone, type LeadTone } from "@/lib/leads";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

// Same tone mapping as before this wrapped the shared Badge primitive —
// see docs/11_UI_REDESIGN_PLAN.md §4.
const TONE_MAP: Record<LeadTone, BadgeTone> = {
  new: "muted",
  active: "info",
  won: "success",
  lost: "danger",
  nurture: "warning",
};

export function LeadStatusBadge({
  status,
  className = "",
}: {
  status: LeadStatus;
  className?: string;
}) {
  return (
    <Badge tone={TONE_MAP[leadTone(status)]} className={className}>
      {LEAD_STATUS_LABEL[status]}
    </Badge>
  );
}

// Only "high" gets an attention-grabbing colour — low/medium stay quiet so
// the one signal worth a glance ("this one's hot") doesn't get lost among
// ten evenly-weighted badges. Shared by the Leads table and board, and the
// Lead Detail header, so a priority reads identically everywhere — built
// on the shared Badge primitive (docs/11_UI_REDESIGN_PLAN.md §4).
const PRIORITY_TONE: Record<LeadPriority, BadgeTone> = {
  low: "muted",
  medium: "info",
  high: "danger",
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
    <Badge tone={PRIORITY_TONE[priority]} className={`capitalize ${className}`}>
      {priority}
      {score != null && ` · ${score}`}
    </Badge>
  );
}
