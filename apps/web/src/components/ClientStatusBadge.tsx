import { CLIENT_STATUS_LABEL, type ClientTone } from "@/lib/clients";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

// Same tone mapping as before this wrapped the shared Badge primitive —
// see docs/11_UI_REDESIGN_PLAN.md §4.
const TONE_MAP: Record<ClientTone, BadgeTone> = {
  onboarding: "muted",
  active: "info",
  complete: "success",
};

export function ClientStatusBadge({ tone, className = "" }: { tone: ClientTone; className?: string }) {
  return (
    <Badge tone={TONE_MAP[tone]} className={className}>
      {CLIENT_STATUS_LABEL[tone]}
    </Badge>
  );
}
