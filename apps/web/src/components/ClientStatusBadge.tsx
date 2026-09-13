import { CLIENT_STATUS_LABEL, type ClientTone } from "@/lib/clients";

// Three tones — same restraint as LeadStatusBadge / ProjectStatusBadge.
const TONE_CLASS: Record<ClientTone, string> = {
  onboarding: "bg-surface-subtle text-fg-muted",
  active: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  complete: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
};

export function ClientStatusBadge({ tone, className = "" }: { tone: ClientTone; className?: string }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]} ${className}`}>
      {CLIENT_STATUS_LABEL[tone]}
    </span>
  );
}
