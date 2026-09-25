"use client";

import type { SVGProps } from "react";
import { featureLabel } from "./websiteBlueprintLib";

/**
 * Small, purely decorative per-feature icons for the requirements board —
 * inline SVG on the same 24px/`currentColor`-stroke grid as `NavIcon`
 * (components/ui/Icons.tsx), so they sit comfortably next to the rest of
 * the app's iconography without a new dependency or generated art. Keyed
 * by the starter `FEATURE_LIBRARY`'s own keys; any other `feature_key`
 * (a custom one, or one carried over from a source this task didn't
 * anticipate) falls back to a plain generic-document glyph rather than
 * rendering nothing.
 */
const FEATURE_ICON_PATHS: Record<string, React.ReactNode> = {
  services: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.3" />
      <rect x="13" y="4" width="7" height="7" rx="1.3" />
      <rect x="4" y="13" width="7" height="7" rx="1.3" />
      <rect x="13" y="13" width="7" height="7" rx="1.3" />
    </>
  ),
  gallery: (
    <>
      <rect x="3.5" y="4.5" width="17" height="14" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.4" />
      <path d="m4.5 16.5 5-5 3.5 3.5 3-3 4.5 4.5" />
    </>
  ),
  pricing: (
    <>
      <path d="M12 3.5 20.5 12 12 20.5 3.5 12Z" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  faq: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.4a2.5 2.5 0 1 1 3.5 2.3c-.9.4-1.1.9-1.1 2" />
      <path d="M12 16.6h.01" strokeWidth={2.4} />
    </>
  ),
  contact: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="m4 7.5 8 5.5 8-5.5" />
    </>
  ),
  booking: (
    <>
      <rect x="3.5" y="4.5" width="17" height="16" rx="2" />
      <path d="M3.5 9.5h17M8 3v3M16 3v3" />
      <path d="m8.5 14.5 2 2 4-4.5" />
    </>
  ),
  about: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 19c1-3.5 3.5-5.5 7-5.5s6 2 7 5.5" />
    </>
  ),
  testimonials: (
    <>
      <path d="M7.5 6.5h-2A2 2 0 0 0 3.5 8.5v2A2 2 0 0 0 5.5 12.5h1L5 16" />
      <path d="M17.5 6.5h-2a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h1L15 16" />
    </>
  ),
};

const DEFAULT_FEATURE_ICON = (
  <>
    <rect x="4.5" y="3.5" width="15" height="17" rx="2" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </>
);

export function FeatureIcon({ featureKey, className = "h-5 w-5" }: { featureKey: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {FEATURE_ICON_PATHS[featureKey] ?? DEFAULT_FEATURE_ICON}
    </svg>
  );
}

/**
 * One compact library card — icon, name, at most one description line,
 * and a dual-path add affordance (draggable onto the canvas, and a
 * click-to-add "+ Add" button that's also fully keyboard-operable).
 * Shared by the requirements board's "Recommended" and "All features"
 * views, same convention as BlueprintLibraryPanel's own `SectionCard`.
 *
 * The board's only duplicate-prevention mechanism is that this card is
 * simply never rendered for a feature already in
 * `planning.blueprint_requirements` — see `availableLibraryFeatures`/
 * `availableRecommendedFeatures` in websiteBlueprintLib.ts, which filter
 * both library views by the canvas's own saved state before either list
 * reaches this component. There is deliberately no "Added"/disabled state
 * here any more (that would be a second, driftable duplicate-prevention
 * layer on top of the filter); the backend's idempotent add is still the
 * backstop for a stale drag payload, not the main UX.
 */
export function FeatureLibraryCard({
  featureKey,
  description,
  busy,
  isBusy,
  onDragStart,
  onAdd,
}: {
  featureKey: string;
  description: string;
  /** Whether *any* add is currently in flight (disables every card's
   * button, not just this one, so a double-click elsewhere can't fire a
   * second request while the first is still resolving). */
  busy: boolean;
  /** Whether *this* card's own add request is the one in flight. */
  isBusy: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onAdd: (trigger: HTMLButtonElement | null) => void;
}) {
  const label = featureLabel(featureKey);
  return (
    <div
      draggable
      // See BlueprintLibraryPanel's SectionCard for why this needs
      // tabIndex={-1}: Chrome tab-stops any [draggable] element by
      // default, which would add a dead stop before the real "+ Add"
      // button right after it.
      tabIndex={-1}
      onDragStart={onDragStart}
      className="cursor-grab rounded-md border border-border bg-surface p-2 active:cursor-grabbing"
    >
      <div className="flex items-center gap-2">
        <FeatureIcon featureKey={featureKey} className="h-5 w-5 shrink-0 text-fg-muted" />
        <p className="min-w-0 truncate text-xs font-medium text-fg">{label}</p>
      </div>
      <p className="mt-1 line-clamp-2 text-[11px] text-fg-subtle">{description}</p>
      <button
        type="button"
        onClick={(e) => onAdd(e.currentTarget)}
        disabled={busy}
        aria-label={`Add ${label}`}
        className="btn btn-secondary btn-sm mt-2 w-full disabled:opacity-50"
      >
        {isBusy ? "Adding…" : "+ Add"}
      </button>
    </div>
  );
}

/**
 * One placed requirement — a small chip on the canvas, not a full-width
 * section wireframe. Clicking it (anywhere but Remove) toggles its notes
 * editor open/closed; the parent owns which one is open (see
 * RequirementsBoard) so at most one editor is ever showing.
 */
export function PlacedRequirementChip({
  featureKey,
  suggested,
  hasNotes,
  selected,
  busy,
  onToggle,
  onRemove,
}: {
  featureKey: string;
  suggested: boolean;
  hasNotes: boolean;
  selected: boolean;
  busy: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const label = featureLabel(featureKey);
  return (
    <div
      className={`group relative flex items-center gap-2 rounded-full border-2 py-1.5 pl-1.5 pr-2 transition-colors duration-fast ease-standard motion-reduce:transition-none ${
        selected ? "border-fg bg-surface-hover" : "border-border bg-surface hover:border-border-strong"
      } ${busy ? "opacity-60" : ""}`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={selected}
        aria-label={`${label}${hasNotes ? " — has notes" : ""}${suggested ? " — suggested" : ""}, edit notes`}
        className="flex min-w-0 items-center gap-1.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-fg-muted">
          <FeatureIcon featureKey={featureKey} className="h-3.5 w-3.5" />
        </span>
        <span className="truncate text-xs font-medium text-fg">{label}</span>
        {hasNotes && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
        {suggested && <span className="shrink-0 text-[10px] font-medium text-fg-subtle">Suggested</span>}
      </button>
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        aria-label={`Remove ${label}`}
        className="shrink-0 rounded-full p-1 text-fg-subtle hover:bg-surface-hover hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-40"
      >
        <CloseGlyph />
      </button>
    </div>
  );
}

function CloseGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true" {...props}>
      <path d="M4.22 4.22a.75.75 0 0 1 1.06 0L10 8.94l4.72-4.72a.75.75 0 1 1 1.06 1.06L11.06 10l4.72 4.72a.75.75 0 1 1-1.06 1.06L10 11.06l-4.72 4.72a.75.75 0 0 1-1.06-1.06L8.94 10 4.22 5.28a.75.75 0 0 1 0-1.06Z" />
    </svg>
  );
}
