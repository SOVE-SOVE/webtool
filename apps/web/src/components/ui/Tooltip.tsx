"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { placeTooltip, pointerShowsTooltip, tooltipHoverDelay, type TooltipSide } from "@/lib/tooltip";

/** When the last tooltip closed — shared, so moving along a row of
 * tooltipped controls skips the hover delay (lib/tooltip.ts). */
let lastHiddenAt: number | null = null;

/**
 * The app's one tooltip for icon-only controls: a short label shown
 * after a brief hover (mouse/pen only — never touch) or at once on
 * keyboard focus, and hidden on pointer leave, blur, press, Escape,
 * scroll and resize.
 *
 * Wrap the control itself: `<Tooltip label="Close"><button aria-label="Close" …/></Tooltip>`.
 * The wrapper is `display: contents`, so the control keeps its exact
 * place in its parent's layout. The control keeps its own `aria-label`
 * — that is its accessible name. The bubble is `aria-hidden` and never
 * referenced by `aria-describedby`, so nothing is announced twice; it
 * is a sighted-user affordance only, and must never be the only place a
 * piece of information lives. Don't also set a native `title`.
 *
 * The bubble is portalled to <body> and `position: fixed` (never
 * clipped by a scroll container, a card's overflow or a container-query
 * ancestor), above every app layer including drawers and modals, kept
 * inside the viewport (flip/shift), and `pointer-events: none`.
 *
 * `open` forces it visible regardless of hover/focus — for a transient
 * status such as CopyButton's "Copied".
 */
export function Tooltip({
  label,
  side = "top",
  open = false,
  children,
}: {
  label: string;
  side?: TooltipSide;
  open?: boolean;
  children: ReactNode;
}) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    setShown((was) => {
      if (was) lastHiddenAt = performance.now();
      return false;
    });
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const visible = (shown || open) && label !== "";
  return (
    <span
      ref={wrapRef}
      className="contents"
      onPointerEnter={(e) => {
        if (!pointerShowsTooltip(e.pointerType)) return;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setShown(true), tooltipHoverDelay(performance.now(), lastHiddenAt));
      }}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(e) => {
        // Keyboard focus only: a click or tap also focuses the control.
        if (e.target instanceof Element && e.target.matches(":focus-visible")) setShown(true);
      }}
      onBlur={hide}
    >
      {children}
      {visible && <TooltipBubble anchorRef={wrapRef} label={label} side={side} onDismiss={hide} />}
    </span>
  );
}

function TooltipBubble({
  anchorRef,
  label,
  side,
  onDismiss,
}: {
  anchorRef: RefObject<HTMLSpanElement | null>;
  label: string;
  side: TooltipSide;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  // Positioned straight on the node before paint (as the card menus are),
  // so there is no measuring render and no frame at the wrong place.
  const place = useCallback(() => {
    const anchor = anchorRef.current?.firstElementChild;
    const el = ref.current;
    if (!anchor || !el) return;
    const placed = placeTooltip({
      anchor: anchor.getBoundingClientRect(),
      tip: { width: el.offsetWidth, height: el.offsetHeight },
      viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
      side,
    });
    el.style.left = `${placed.left}px`;
    el.style.top = `${placed.top}px`;
    el.style.visibility = "visible";
  }, [anchorRef, side]);

  useLayoutEffect(place, [place, label]);

  useEffect(() => {
    // A forced-open bubble outlives the dismissal, so it also re-places.
    const onMove = () => {
      onDismiss();
      place();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [onDismiss, place]);

  return createPortal(
    <span ref={ref} aria-hidden="true" className="tooltip-bubble" style={{ left: 0, top: 0, visibility: "hidden" }}>
      {label}
    </span>,
    document.body,
  );
}
