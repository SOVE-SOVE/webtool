import type { LeadStatus } from "@/lib/api";
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
