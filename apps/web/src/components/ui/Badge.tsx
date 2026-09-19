import type { ReactNode } from "react";

/**
 * The shared status-pill tones, backed by the --pill-* tokens in
 * globals.css. "muted" is the odd one out — it reuses the existing
 * --surface-subtle/--fg-muted surface tokens rather than a dedicated
 * pill token, since a neutral/no-status pill should always track
 * whatever the app's neutral surface looks like.
 *
 * Kept to the small set every existing status actually needs (see
 * docs/11_UI_REDESIGN_PLAN.md §2.1/§3) rather than exposing arbitrary
 * Tailwind colors — a new status tone should extend this list (and its
 * --pill-* tokens), not bypass it with an inline class.
 */
export type BadgeTone = "muted" | "info" | "success" | "warning" | "danger" | "highlight" | "violet" | "critical" | "accent";

const TONE_CLASS: Record<BadgeTone, string> = {
  muted: "bg-surface-subtle text-fg-muted",
  info: "bg-pill-info-bg text-pill-info-fg",
  success: "bg-pill-success-bg text-pill-success-fg",
  warning: "bg-pill-warning-bg text-pill-warning-fg",
  danger: "bg-pill-danger-bg text-pill-danger-fg",
  highlight: "bg-pill-highlight-bg text-pill-highlight-fg",
  // A distinct categorical tag (not a severity/status gradient) — e.g. a
  // "which project" label or a workflow stage handed off to a client.
  violet: "bg-pill-violet-bg text-pill-violet-fg",
  // Solid, not a soft pill — the one severity tier meant to read as
  // stronger than "danger" (e.g. a QA check severe enough to block
  // sign-off outright).
  critical: "bg-pill-critical-bg text-pill-critical-fg",
  // The app's own primary-action color, solid — for the one state in a
  // sequence that should outweigh every other tone (e.g. "deployed" at
  // the end of a workflow).
  accent: "bg-accent text-accent-fg",
};

/**
 * A small status pill — the shared primitive behind every "status
 * badge" in the app. Domain-specific badges (LeadStatusBadge,
 * ClientStatusBadge, ProjectStatusBadge, ...) should map their own
 * status enum to a `BadgeTone` and render this rather than hand-rolling
 * their own `<span>` + color classes, so every status pill in the app
 * shares one shape and one palette.
 */
export function Badge({
  tone = "muted",
  children,
  className = "",
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium transition-colors duration-base ease-standard motion-reduce:transition-none ${TONE_CLASS[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
