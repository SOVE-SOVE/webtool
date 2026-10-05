"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createFlipController, FLIP_MS, INITIAL_FLIP_STATE, type Face, type FlipController, type FlipEvent } from "./cardFlip";

/** Live `matchMedia` result — false during SSR, then tracks changes (a mouse plugged in, a reduced-motion toggle). */
function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * React wiring for cardFlip's controller: one controller per mounted
 * card (cards are keyed by client id, so a timer can only ever touch its
 * own client), disposed — timers cleared — on unmount.
 */
export function useCardFlip() {
  const hoverCapable = useMediaQuery("(hover: hover) and (pointer: fine)");
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [state, setState] = useState(INITIAL_FLIP_STATE);
  const stateRef = useRef(state);
  const controllerRef = useRef<FlipController | null>(null);
  const releaseRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const controller = createFlipController({
      initial: stateRef.current,
      onChange: (next) => {
        stateRef.current = next;
        setState(next);
      },
    });
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      controllerRef.current = null;
      releaseRef.current?.();
    };
  }, []);

  const send = useCallback((e: FlipEvent) => controllerRef.current?.dispatch(e), []);

  useEffect(() => {
    send({ type: "hoverCapability", enabled: hoverCapable });
  }, [hoverCapable, send]);

  // Both faces stay painted while the card is turning, so the one
  // turning away doesn't vanish mid-rotation; `moving` is cleared
  // FLIP_MS after the latest face change (a mid-flight reversal
  // restarts it). Under reduced motion the swap is instant.
  const [shownFace, setShownFace] = useState<Face>(state.face);
  const [moving, setMoving] = useState(false);
  if (shownFace !== state.face) {
    setShownFace(state.face);
    setMoving(!reducedMotion);
  }
  useEffect(() => {
    if (!moving) return;
    const id = setTimeout(() => setMoving(false), FLIP_MS);
    return () => clearTimeout(id);
  }, [moving, shownFace]);

  /** Pointer handlers for the card's static outer wrapper. Touch never counts as hover. */
  const pointerHandlers = {
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType !== "touch") send({ type: "pointerEnter" });
    },
    onPointerLeave: (e: React.PointerEvent) => {
      if (e.pointerType !== "touch") send({ type: "pointerLeave" });
    },
    onPointerDown: () => {
      send({ type: "press", down: true });
      if (releaseRef.current) return;
      // The release can land anywhere (a drag off the card), so listen on window.
      const release = () => {
        window.removeEventListener("pointerup", release);
        window.removeEventListener("pointercancel", release);
        releaseRef.current = null;
        send({ type: "press", down: false });
      };
      window.addEventListener("pointerup", release);
      window.addEventListener("pointercancel", release);
      releaseRef.current = release;
    },
  };

  /** Focus handlers for the outer wrapper — React's onFocus/onBlur bubble like focusin/focusout. */
  const focusHandlers = {
    onFocus: () => send({ type: "focusIn" }),
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) send({ type: "focusOut" });
    },
  };

  return {
    face: state.face,
    /** A real mouse is over the card — drives the (non-motion) border/shadow emphasis. */
    hovered: state.hoverEnabled && state.hovering,
    /** Lift only for a real hovering mouse, and never under reduced motion. */
    lifted: state.hoverEnabled && state.hovering && !reducedMotion,
    moving,
    reducedMotion,
    pointerHandlers,
    focusHandlers,
    showDetails: () => send({ type: "details" }),
    showFront: () => send({ type: "back" }),
    /** The pointer is known to have left without a pointerleave (e.g. the card moved out from under a resting pointer). */
    pointerLeft: () => send({ type: "pointerLeave" }),
    setMenuOpen: (open: boolean) => send({ type: "menu", open }),
  };
}
