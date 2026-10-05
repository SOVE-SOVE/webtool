"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { planFlip, sameSpot, shiftRects, translationOf, type FlipOptions, type FlipRect } from "./layoutFlip";

export type LayoutFlipOptions = FlipOptions & {
  /** ms. Defaults to 200 (the `--duration-base` token). */
  duration?: number;
  /** Keyframes for an item that wasn't there before (e.g. a gentle
   * settle). Omit to leave new items alone. Never plays on first render. */
  enter?: Keyframe[];
  /** Set false to switch the effect off without unmounting anything. */
  enabled?: boolean;
};

const EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)"; // --ease-out-calm
const MOVE_ID = "layout-flip";
const ENTER_ID = "layout-flip-enter";

type Caught = {
  /** How far the running animation currently displaces the item, or
   * `null` when that can't be read (not a plain translation). */
  offset: { x: number; y: number } | null;
  /** Its opacity mid-fade, when it was still settling in. */
  opacity: string | null;
  animations: Animation[];
};
type Measured = {
  elements: Map<string, HTMLElement>;
  /** Each item's real layout box (viewport-relative), animation excluded. */
  rects: Map<string, FlipRect>;
  /** Items caught mid-animation. */
  caught: Map<string, Caught>;
  /** Where the container's own content starts on screen. */
  originX: number;
  originY: number;
};

function toRect(r: DOMRect): FlipRect {
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/**
 * One read pass over the container's keyed items. An item caught
 * mid-animation is measured where it visibly is, and its real layout box
 * is recovered by subtracting the animated translation — without
 * cancelling anything, so an unrelated re-render can't cut an animation
 * short.
 */
function measure(container: HTMLElement): Measured {
  const elements = new Map<string, HTMLElement>();
  for (const el of container.querySelectorAll<HTMLElement>("[data-flip-key]")) {
    if (el.dataset.flipKey) elements.set(el.dataset.flipKey, el);
  }
  const caught = new Map<string, Caught>();
  const rects = new Map<string, FlipRect>();
  for (const [key, el] of elements) {
    const animations = el.getAnimations().filter((a) => a.id === MOVE_ID || a.id === ENTER_ID);
    let rect = toRect(el.getBoundingClientRect());
    if (animations.length > 0) {
      const style = getComputedStyle(el);
      const offset = translationOf(style.transform);
      const entering = animations.some((a) => a.id === ENTER_ID);
      caught.set(key, { offset, opacity: entering ? style.opacity : null, animations });
      if (offset) {
        rect = { ...rect, left: rect.left - offset.x, top: rect.top - offset.y };
      } else {
        // Not a plain translation (a caller's own `enter` scale, say):
        // the only way to see the real box is to stop the animation.
        for (const a of animations) a.cancel();
        rect = toRect(el.getBoundingClientRect());
      }
    }
    rects.set(key, rect);
  }
  const box = container.getBoundingClientRect();
  return { elements, rects, caught, originX: box.left - container.scrollLeft, originY: box.top - container.scrollTop };
}

/**
 * Smoothly moves keyed children of `containerRef` to their new places
 * when the layout changes (items added, removed, filtered or reordered).
 *
 * Mark each animatable element with `data-flip-key="<stable id>"`. It
 * must be an element whose `transform` nothing else animates — wrap a
 * card that has its own transform (a 3D flip, a hover lift) rather than
 * marking the card itself.
 *
 * Runs after every commit, but only measures (one read pass, then one
 * write pass); it starts an animation only when something actually
 * moved. Uses the Web Animations API, so it never touches inline
 * styles or classes, never remounts anything, leaves focus alone, and a
 * newer change simply replaces a running animation from where the item
 * visibly is. A re-render that doesn't change where an item is heading
 * leaves its animation running untouched.
 *
 * Positions are compared relative to the container, so only movement
 * *within* it counts: scrolling (the page, an outer panel, or the
 * container itself) and the container being pushed around by something
 * else on the page never read as a layout change. The container being
 * resized (a window resize re-wrapping its items) isn't animated either
 * — the new positions are just noted. Skipped entirely under
 * `prefers-reduced-motion`.
 */
export function useLayoutFlip(containerRef: RefObject<HTMLElement | null>, options: LayoutFlipOptions = {}): void {
  const prevRef = useRef<{ rects: Map<string, FlipRect>; originX: number; originY: number } | null>(null);
  const optionsRef = useRef(options);
  const observerRef = useRef<ResizeObserver | null>(null);
  const watchedRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    optionsRef.current = options;
    const container = containerRef.current;
    const { enabled = true, duration = 200, enter, ...planOptions } = optionsRef.current;
    // A resized container re-wraps its items with no React commit to
    // measure on. Watch for that and note the new positions as they
    // happen, so the next real change doesn't animate from a layout
    // that's long gone.
    if (watchedRef.current !== container) {
      observerRef.current?.disconnect();
      watchedRef.current = container;
      if (container && typeof ResizeObserver !== "undefined") {
        observerRef.current ??= new ResizeObserver(() => {
          const watched = watchedRef.current;
          if (!prevRef.current || !watched?.isConnected) return;
          const now = measure(watched);
          prevRef.current = { rects: now.rects, originX: now.originX, originY: now.originY };
        });
        observerRef.current.observe(container);
      }
    }

    if (!container || !enabled) {
      prevRef.current = null;
      return;
    }

    const { elements, rects, caught, originX, originY } = measure(container);
    const prev = prevRef.current;
    prevRef.current = { rects, originX, originY };

    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!prev || reduced) return;

    // Where each item was: last layout, carried along with the container
    // — or, for one whose destination just changed mid-animation, where
    // it had got to on screen (its old place plus how far the animation
    // still displaced it; measuring it now would be too late, the layout
    // underneath has already moved).
    const before = shiftRects(prev.rects, originX - prev.originX, originY - prev.originY);
    const redirected: Caught[] = [];
    for (const [key, item] of caught) {
      const was = before.get(key);
      const now = rects.get(key);
      if (item.offset && was && now && sameSpot(was, now)) continue; // still heading to the same place
      if (was && item.offset) before.set(key, { ...was, left: was.left + item.offset.x, top: was.top + item.offset.y });
      redirected.push(item);
    }

    const plan = planFlip(before, rects, { width: window.innerWidth, height: window.innerHeight }, planOptions);

    // Write pass.
    for (const item of redirected) {
      if (item.offset) for (const a of item.animations) a.cancel();
    }
    for (const { key, dx, dy } of plan.moves) {
      // An item redirected while still fading in keeps the opacity it
      // had reached (the end keyframe is left to its own resting value).
      const opacity = caught.get(key)?.opacity;
      const from: Keyframe = { transform: `translate(${dx}px, ${dy}px)` };
      if (opacity != null) from.opacity = opacity;
      const anim = elements.get(key)?.animate([from, { transform: "translate(0, 0)" }], { duration, easing: EASE });
      if (anim) anim.id = opacity != null ? ENTER_ID : MOVE_ID;
    }
    if (enter) {
      for (const key of plan.entered) {
        const anim = elements.get(key)?.animate(enter, { duration, easing: EASE });
        if (anim) anim.id = ENTER_ID;
      }
    }
  });

  // Stop watching when the host component goes away.
  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      watchedRef.current = null;
    },
    [],
  );
}
