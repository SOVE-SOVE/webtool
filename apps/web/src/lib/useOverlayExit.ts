"use client";

import { useLayoutEffect } from "react";
import { exitStartStyle, shouldPlayOverlayExit, type ExitStartStyle } from "./overlayExit";

// The overlay a drawer lives in: the shared side panel's own backdrop, or
// an element that opts in (the navigation sheet's wrapper).
const ROOT_SELECTOR = ".side-panel-overlay, [data-overlay-exit-root]";
// The parts that have an entrance of their own, and so an exit
// (globals.css): the backdrop fades, the panel slides.
const MOVING_SELECTOR = ".side-panel-overlay, .modal-overlay, .side-panel, .animate-slide-in-left";
const EXIT_ATTR = "data-overlay-exit";
// Backstop for a copy whose `animationend` never arrives.
const REMOVE_AFTER_MS = 400;

// Counts drawer mounts, so a close can tell it was really a swap.
let mountSeq = 0;

type Snapshot = {
  starts: Map<number, ExitStartStyle>;
  scrolls: Map<number, { top: number; left: number }>;
  selected: Map<number, number>;
};

function elementsOf(root: HTMLElement): HTMLElement[] {
  return [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))];
}

function removeExitingOverlays() {
  document.querySelectorAll(`[${EXIT_ATTR}]`).forEach((el) => el.remove());
}

/** What a copy can't inherit from the markup: how far an entrance had
 * got, scroll positions, and a select's current choice. */
function takeSnapshot(root: HTMLElement): Snapshot {
  const snapshot: Snapshot = { starts: new Map(), scrolls: new Map(), selected: new Map() };
  elementsOf(root).forEach((el, i) => {
    if (el.matches(MOVING_SELECTOR)) {
      const computed = el.isConnected ? getComputedStyle(el) : null;
      snapshot.starts.set(i, exitStartStyle(computed && { opacity: computed.opacity, transform: computed.transform }));
    }
    if (el.scrollTop !== 0 || el.scrollLeft !== 0) snapshot.scrolls.set(i, { top: el.scrollTop, left: el.scrollLeft });
    if (el instanceof HTMLSelectElement) snapshot.selected.set(i, el.selectedIndex);
  });
  return snapshot;
}

function playExit(root: HTMLElement, snapshot: Snapshot) {
  const copy = root.cloneNode(true) as HTMLElement;
  const parts = elementsOf(copy);

  // Inert and hidden from assistive tech: it can't be clicked, focused or
  // read, and it doesn't duplicate the ids of a drawer opened meanwhile.
  copy.setAttribute(EXIT_ATTR, "");
  copy.setAttribute("aria-hidden", "true");
  copy.inert = true;
  for (const el of parts) {
    el.removeAttribute("id");
    if (el instanceof HTMLIFrameElement) el.removeAttribute("src");
  }
  snapshot.starts.forEach((start, i) => {
    if (start.opacity !== null) parts[i].style.opacity = start.opacity;
    if (start.transform !== null) parts[i].style.transform = start.transform;
  });
  snapshot.selected.forEach((index, i) => {
    (parts[i] as HTMLSelectElement).selectedIndex = index;
  });

  document.body.appendChild(copy);
  snapshot.scrolls.forEach(({ top, left }, i) => {
    parts[i].scrollTop = top;
    parts[i].scrollLeft = left;
  });

  const timeout = window.setTimeout(() => copy.remove(), REMOVE_AFTER_MS);
  copy.addEventListener("animationend", () => {
    // The backdrop and the panel end together; either one is the end.
    window.clearTimeout(timeout);
    copy.remove();
  });
}

/**
 * Gives a drawer an exit transition without changing how it closes.
 *
 * The drawer keeps unmounting the moment it's dismissed, so nothing about
 * its dismissal, focus restoration or the page behind is delayed. As it
 * unmounts, a copy of what it showed is left in `<body>` for the length
 * of the exit keyframes (globals.css, `[data-overlay-exit]`) — inert,
 * click-through, hidden from assistive tech — then removed. Opening any
 * drawer removes a copy still leaving, so two never overlap.
 *
 * `ref` is any element inside the overlay (or the overlay itself). Call
 * it from the component that unmounts with the drawer: the copy is taken
 * in that component's layout-effect cleanup, while the drawer is still in
 * the document. `useDismissableOverlay` already does, for every drawer
 * built on it.
 */
export function useOverlayExit(ref: React.RefObject<HTMLElement | null>, active = true) {
  useLayoutEffect(() => {
    const root = active ? ref.current?.closest<HTMLElement>(ROOT_SELECTOR) : null;
    if (!root) return;
    mountSeq += 1;
    removeExitingOverlays();

    return () => {
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const documentHidden = document.hidden;
      if (reducedMotion || documentHidden) return;
      const snapshot = takeSnapshot(root);
      const seq = mountSeq;
      // After this update has finished: by then the drawer is out of the
      // document, and a drawer replacing it has mounted.
      queueMicrotask(() => {
        const play = shouldPlayOverlayExit({
          reducedMotion,
          documentHidden,
          stillConnected: root.isConnected,
          replaced: mountSeq !== seq,
        });
        if (play) playExit(root, snapshot);
      });
    };
  }, [ref, active]);
}
