"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type SVGProps } from "react";
import { createPortal } from "react-dom";
import { useDismissableOverlay } from "@/lib/useDismissableOverlay";
import {
  FEATURE_BY_KEY,
  FEATURE_CATEGORY_LABEL,
  FEATURE_KIND_LABEL,
  featureKind,
  featureLabel,
  type FeatureDefinition,
  type FeatureKind,
} from "./websiteBlueprintLib";

/**
 * Small, purely decorative per-feature icons for the requirements board —
 * inline SVG on the same 24px/`currentColor`-stroke grid as `NavIcon`
 * (components/ui/Icons.tsx), so they sit comfortably next to the rest of
 * the app's iconography without a new dependency or generated art. Keyed
 * by `FEATURE_LIBRARY`'s own keys; a catalogue key without its own glyph
 * falls back to one per kind (`KIND_FALLBACK_ICON`), and any other
 * `feature_key` (a custom one, or one carried over from a source this
 * task didn't anticipate) to a plain generic-document glyph rather than
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
  team: (
    <>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19c.8-3 2.8-4.8 5.5-4.8s4.7 1.8 5.5 4.8" />
      <circle cx="16.5" cy="9" r="2.5" />
      <path d="M16 14.3c2.3.2 3.8 1.8 4.5 4.2" />
    </>
  ),
  how_it_works: (
    <>
      <circle cx="5.5" cy="12" r="2.2" />
      <circle cx="12" cy="12" r="2.2" />
      <circle cx="18.5" cy="12" r="2.2" />
      <path d="M7.7 12h2.1M14.2 12h2.1" />
    </>
  ),
  service_areas: (
    <>
      <path d="M12 20.5s6-5.3 6-10.5a6 6 0 1 0-12 0c0 5.2 6 10.5 6 10.5Z" />
      <circle cx="12" cy="10" r="2.2" />
    </>
  ),
  opening_hours: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  case_studies: (
    <>
      <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
      <path d="m8.5 15.5 2.5-2.5 2 2 3-3.5" />
    </>
  ),
  before_after: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="M12 4v16" />
      <path d="m8.5 10.5-2 1.5 2 1.5M15.5 10.5l2 1.5-2 1.5" />
    </>
  ),
  accreditations: (
    <>
      <circle cx="12" cy="9.5" r="5.5" />
      <path d="m9 14.5-1.5 6 4.5-2.5 4.5 2.5-1.5-6" />
    </>
  ),
  brochure: (
    <>
      <path d="M6.5 3.5h7l4 4v11a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" />
      <path d="M12 10v6.5M9.5 14l2.5 2.5 2.5-2.5" />
    </>
  ),
  blog: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <rect x="7" y="8" width="4.5" height="4" rx=".6" />
      <path d="M14 8.5h3M14 11.5h3M7 15.5h10" />
    </>
  ),
  careers: (
    <>
      <rect x="3.5" y="7.5" width="17" height="12" rx="2" />
      <path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M3.5 12.5h17" />
    </>
  ),
  quote_request: (
    <>
      <rect x="5" y="4.5" width="14" height="16" rx="2" />
      <path d="M9 3.5h6v2.5H9zM8.5 11h7M8.5 14.5h7M8.5 18h4" />
    </>
  ),
  reservations: (
    <>
      <rect x="3.5" y="4.5" width="17" height="16" rx="2" />
      <path d="M3.5 9.5h17M8 3v3M16 3v3" />
      <path d="M8 13.5h.01M12 13.5h.01M16 13.5h.01M8 17h.01M12 17h.01" strokeWidth={2.4} />
    </>
  ),
  newsletter: (
    <>
      <path d="M20.5 3.5 3.5 10.5l7 2.5 2.5 7Z" />
      <path d="m10.5 13 4-4" />
    </>
  ),
  file_upload: (
    <path d="m19 11.5-7.1 7.1a4.5 4.5 0 0 1-6.4-6.4l7.4-7.4a3 3 0 0 1 4.2 4.2l-7.2 7.2a1.5 1.5 0 0 1-2.1-2.1l6.5-6.5" />
  ),
  product_catalogue: (
    <>
      <path d="M3.5 12.2V5.5a2 2 0 0 1 2-2h6.7l8.3 8.3-8.7 8.7Z" />
      <circle cx="8" cy="8" r="1.4" />
    </>
  ),
  online_store: (
    <>
      <path d="M5.5 7.5h13l-1 12.5h-11Z" />
      <path d="M9 9.5V7a3 3 0 0 1 6 0v2.5" />
    </>
  ),
  payments: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="M3 10h18M6.5 14.5h4" />
    </>
  ),
  customer_login: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2" />
    </>
  ),
  live_chat: (
    <>
      <path d="M4.5 6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4 3.5v-3.5a2 2 0 0 1-2-2Z" />
      <path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01" strokeWidth={2.4} />
    </>
  ),
  style_light: (
    <>
      <circle cx="12" cy="12" r="3.8" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
    </>
  ),
  style_dark: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z" />,
  style_bold_type: <path d="M5.5 6.5V4.5h13v2M12 4.5v15M9 19.5h6" strokeWidth={2.2} />,
  style_editorial: (
    <>
      <rect x="4.5" y="3.5" width="15" height="17" rx="2" />
      <path d="M8 8h5M8 12.5h8M8 15.5h8" />
    </>
  ),
  style_full_width_images: (
    <>
      <path d="M2.5 6.5h19v11h-19Z" />
      <path d="m2.5 15.5 5-4.5 4 3.5 3-2.5 7 4.5" />
    </>
  ),
  style_rounded_cards: (
    <>
      <rect x="3.5" y="5" width="7.5" height="14" rx="3" />
      <rect x="13" y="5" width="7.5" height="14" rx="3" />
    </>
  ),
  style_gradients: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <path d="M3.5 14 14 3.5M3.5 19.5 19.5 3.5M9.5 20.5l11-11" />
    </>
  ),
  style_texture: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <path d="M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" strokeWidth={2.2} />
    </>
  ),
  style_alternating: (
    <>
      <rect x="3.5" y="4" width="7" height="6" rx="1.2" />
      <rect x="13.5" y="14" width="7" height="6" rx="1.2" />
      <path d="M13.5 6h7M13.5 8.5h4.5M3.5 16h7M3.5 18.5h4.5" />
    </>
  ),
  style_fullscreen_hero: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  video_hero: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="m10.5 9.2 4.5 2.8-4.5 2.8Z" />
    </>
  ),
  image_carousel: (
    <>
      <rect x="6.5" y="5.5" width="11" height="13" rx="1.5" />
      <path d="m3.5 10-1.5 2 1.5 2M20.5 10l1.5 2-1.5 2" />
    </>
  ),
  filterable_gallery: <path d="M3.5 5h17l-6.5 7.5v5.5l-4 2v-7.5Z" />,
  animated_stats: <path d="M4 20V14M9.5 20V10M15 20v-7M20.5 20V5M3.5 20.5h17.5" />,
  scroll_reveals: (
    <>
      <rect x="7.5" y="3.5" width="9" height="14" rx="4.5" />
      <path d="M12 7v2.5M9.5 20.5 12 22l2.5-1.5" />
    </>
  ),
  hover_effects: <path d="m5 3.5 13 7.2-5.8 1.4 3.3 6.4-2.3 1.2-3.3-6.4L5.5 17Z" />,
  page_transitions: (
    <>
      <rect x="3.5" y="6.5" width="11" height="13" rx="1.5" />
      <path d="M8.5 6.5v-1a1.5 1.5 0 0 1 1.5-1.5h8.5a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5h-4" />
    </>
  ),
  sticky_nav: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <path d="M3.5 8h17M7 12.5h10M7 16h7" />
    </>
  ),
  sticky_cta: (
    <path d="M7.5 3.5h-2a2 2 0 0 0-2 2.2c.9 7.6 7.2 13.9 14.8 14.8a2 2 0 0 0 2.2-2v-2l-4-1.8-2 2a12 12 0 0 1-5.4-5.4l2-2Z" />
  ),
};

const DEFAULT_FEATURE_ICON = (
  <>
    <rect x="4.5" y="3.5" width="15" height="17" rx="2" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </>
);

/** Fallbacks by kind for a catalogue key without its own glyph — a plug
 * for functionality, a palette for design, a sparkle for site-wide
 * behaviour. Content sections (and unknown keys) use the document. */
const KIND_FALLBACK_ICON: Partial<Record<FeatureKind, React.ReactNode>> = {
  capability: <path d="M9 3.5v4M15 3.5v4M6.5 7.5h11v3a5.5 5.5 0 0 1-11 0ZM12 16v4.5" />,
  design: (
    <>
      <path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.3-1-1.6-1-2.8 0-1 .8-1.7 1.8-1.7h2a3.9 3.9 0 0 0 3.9-3.9c0-3.8-3.8-6.9-8.5-6.9Z" />
      <path d="M7.5 11h.01M10 7.5h.01M14.5 7.5h.01" strokeWidth={2.4} />
    </>
  ),
  behaviour: <path d="M12 3.5 13.8 10.2 20.5 12l-6.7 1.8L12 20.5l-1.8-6.7L3.5 12l6.7-1.8Z" />,
};

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
      {FEATURE_ICON_PATHS[featureKey] ?? KIND_FALLBACK_ICON[featureKind(featureKey)] ?? DEFAULT_FEATURE_ICON}
    </svg>
  );
}

/** The card face's quiet kind hint — content sections carry none, so only
 * the choices that aren't a block of content get a word. The full
 * `FEATURE_KIND_LABEL` lives in the details popover. */
const KIND_HINT: Partial<Record<FeatureKind, string>> = {
  capability: "Functionality",
  design: "Design",
  behaviour: "Site-wide",
};

/** Preferences (design/behaviour) aren't content, so their placed chips
 * read slightly differently — see PlacedRequirementChip. */
function isPreferenceKind(kind: FeatureKind): boolean {
  return kind === "design" || kind === "behaviour";
}

/**
 * One compact library card — icon, name, a short description, and a
 * dual-path add affordance (draggable onto the canvas, and a
 * click-to-add "+ Add to plan" button that's also fully keyboard-operable).
 * Shared by the requirements board's "Recommended" and "All features"
 * views, same convention as BlueprintLibraryPanel's own `SectionCard`.
 * A small "i" button opens the feature's details (longer explanation,
 * kind, real content it needs, motion guidance) in a popover, so none of
 * that crowds the card face.
 *
 * `recommendation` is set only in the Recommended view: the description
 * is then the evidence ("Why suggested"), and adding the card is the
 * decision on every recommendation behind it — so the card says how many
 * there are (one card per feature, never one per source) and flags the
 * reconciliation state where one was accepted earlier but the feature
 * never made it onto the canvas.
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
  recommendation,
  busy,
  isBusy,
  onDragStart,
  onAdd,
}: {
  featureKey: string;
  description: string;
  /** Recommended view only — see the component comment. */
  recommendation?: { count: number; acceptedEarlier: boolean };
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
  const kindHint = KIND_HINT[featureKind(featureKey)];
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
      <div className="flex items-start gap-2">
        <FeatureIcon featureKey={featureKey} className="mt-px h-5 w-5 shrink-0 text-fg-muted" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-fg" title={label}>
            {label}
          </p>
          {kindHint && <p className="text-[10px] leading-tight text-fg-subtle">{kindHint}</p>}
        </div>
        {recommendation && recommendation.count > 1 && (
          <span
            className="mt-px shrink-0 rounded-full bg-surface-subtle px-1.5 text-[10px] font-medium text-fg-muted"
            title={`Backed by ${recommendation.count} recommendations`}
          >
            {recommendation.count} sources
          </span>
        )}
        <FeatureDetailsButton featureKey={featureKey} />
      </div>
      {recommendation ? (
        <>
          <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">Why suggested</p>
          {/* Clamped visually only — the full evidence text stays in the
              DOM for assistive tech, and in `title` for a pointer hover. */}
          <p className="mt-0.5 line-clamp-3 text-[11px] text-fg-muted" title={description}>
            {description}
          </p>
          {recommendation.acceptedEarlier && (
            <p className="mt-1.5 rounded bg-pill-info-bg px-1.5 py-1 text-[11px] font-medium text-pill-info-fg">
              Accepted earlier — not on the plan yet
            </p>
          )}
        </>
      ) : (
        <p className="mt-1 line-clamp-2 text-[11px] text-fg-subtle">{description}</p>
      )}
      <button
        type="button"
        onClick={(e) => onAdd(e.currentTarget)}
        disabled={busy}
        aria-label={`Add ${label} to the plan`}
        className="btn btn-secondary btn-sm mt-2 w-full disabled:opacity-50"
      >
        {isBusy ? "Adding…" : "+ Add to plan"}
      </button>
    </div>
  );
}

/** The card's "i" trigger. Renders nothing for a key outside the
 * catalogue (there's no detail to show). */
function FeatureDetailsButton({ featureKey }: { featureKey: string }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const feature = FEATURE_BY_KEY[featureKey];
  if (!feature) return null;
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`About ${feature.label}`}
        className={`-mr-0.5 -mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors duration-fast ease-standard hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring motion-reduce:transition-none ${
          open ? "bg-surface-hover text-fg" : "text-fg-subtle"
        }`}
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4" aria-hidden="true">
          <circle cx="10" cy="10" r="7.25" />
          <path d="M10 9v4.5" strokeLinecap="round" />
          <circle cx="10" cy="6.5" r=".9" fill="currentColor" stroke="none" />
        </svg>
      </button>
      {open && (
        <FeatureDetailsPopover
          id={panelId}
          feature={feature}
          triggerRef={triggerRef}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

const POPOVER_GAP = 8;

/**
 * A feature's details, anchored beside its "i" trigger. Portalled to
 * <body> with fixed positioning because the library list scrolls
 * (`overflow-y-auto`), which would otherwise clip it, and the column is
 * too narrow to hold it — so it opens to the right of the card, over the
 * canvas, or to the left when there isn't room.
 *
 * Focus handling is the app's shared `useDismissableOverlay` (focus moves
 * in, Escape closes, Tab stays inside, focus returns to the trigger on
 * close); an outside pointer-down, a scroll outside the panel or a resize
 * also closes it, since a fixed panel would otherwise drift away from its
 * card.
 */
function FeatureDetailsPopover({
  id,
  feature,
  triggerRef,
  onClose,
}: {
  id: string;
  feature: FeatureDefinition;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const { containerRef } = useDismissableOverlay({ open: true, onClose });
  const titleId = useId();

  useLayoutEffect(() => {
    const panel = containerRef.current;
    const trigger = triggerRef.current;
    if (!panel || !trigger) return;
    const anchor = trigger.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = panel;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = anchor.right + POPOVER_GAP;
    if (left + width > vw - POPOVER_GAP) left = anchor.left - width - POPOVER_GAP;
    left = Math.max(POPOVER_GAP, Math.min(left, vw - width - POPOVER_GAP));
    const top = Math.max(POPOVER_GAP, Math.min(anchor.top - 4, vh - height - POPOVER_GAP));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.visibility = "visible";
  }, [containerRef, triggerRef]);

  useEffect(() => {
    function isInside(target: EventTarget | null) {
      return (
        target instanceof Node && (containerRef.current?.contains(target) || triggerRef.current?.contains(target))
      );
    }
    function handlePointerDown(e: PointerEvent) {
      if (!isInside(e.target)) onClose();
    }
    function handleScroll(e: Event) {
      if (!(e.target instanceof Node && containerRef.current?.contains(e.target))) onClose();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [containerRef, triggerRef, onClose]);

  return createPortal(
    <div
      ref={containerRef}
      id={id}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      // Hidden until the layout effect has placed it, so it never flashes
      // at the corner first. Text inside is selectable; stop a text drag
      // from bubbling (through the React tree) into the card's own
      // drag-to-add handler.
      style={{ visibility: "hidden" }}
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      className="animate-rise-in fixed left-0 top-0 z-50 max-h-[calc(100vh-16px)] w-72 overflow-y-auto rounded-xl border border-border bg-surface p-3 shadow-xl outline-none"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={titleId} className="text-sm font-semibold text-fg">
            {feature.label}
          </h3>
          <p className="text-[11px] text-fg-subtle">
            {FEATURE_KIND_LABEL[feature.kind]} · {FEATURE_CATEGORY_LABEL[feature.category]}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="-mr-1 -mt-1 shrink-0 rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          <CloseGlyph />
        </button>
      </div>
      <p className="mt-2 text-xs text-fg-muted">{feature.detail}</p>
      {feature.needsRealContent && (
        <p className="mt-2 text-xs text-fg">
          <span className="font-medium">Needs real content:</span>{" "}
          <span className="text-fg-muted">{feature.needsRealContent}</span>
        </p>
      )}
      {feature.motionNote && (
        <p className="mt-2 text-xs text-fg">
          <span className="font-medium">Motion &amp; performance:</span>{" "}
          <span className="text-fg-muted">{feature.motionNote}</span>
        </p>
      )}
    </div>,
    document.body,
  );
}

/**
 * One placed requirement — a small chip on the canvas, not a full-width
 * section wireframe. Clicking it (anywhere but Remove) toggles its notes
 * editor open/closed; the parent owns which one is open (see
 * RequirementsBoard) so at most one editor is ever showing.
 *
 * Design and site-wide choices get a quiet tinted fill so a preference
 * reads differently from content at a glance (and say so to assistive
 * tech); chip order still carries no meaning.
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
  const kind = featureKind(featureKey);
  const preference = isPreferenceKind(kind);
  return (
    <div
      className={`group relative flex items-center gap-2 rounded-full border-2 py-1.5 pl-1.5 pr-2 transition-colors duration-fast ease-standard motion-reduce:transition-none ${
        selected
          ? "border-fg bg-surface-hover"
          : preference
            ? "border-border bg-surface-subtle hover:border-border-strong"
            : "border-border bg-surface hover:border-border-strong"
      } ${busy ? "opacity-60" : ""}`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={selected}
        aria-label={`${label}${preference ? ` (${FEATURE_KIND_LABEL[kind].toLowerCase()})` : ""}${hasNotes ? " — has notes" : ""}${suggested ? " — suggested" : ""}, edit notes`}
        className="flex min-w-0 items-center gap-1.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-fg-muted ${
            preference ? "border border-dashed border-border-strong bg-surface" : "bg-surface-subtle"
          }`}
        >
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
