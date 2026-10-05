/**
 * The Overview ClientCard's front/back state, as a pure reducer plus a
 * tiny timer controller — no React, no DOM — so every rule below is
 * unit-testable with fake timers.
 *
 * Rules:
 * - Hover (fine pointers only) flips to the back after HOVER_FLIP_MS of
 *   continuous hover; leaving earlier cancels it. Never while focus is
 *   inside the card, the ⋯ menu is open, or a press is in progress.
 * - A hover-opened back returns to the front LEAVE_GRACE_MS after the
 *   pointer leaves, unless focus is inside the card.
 * - Details/Back clicks are explicit: an explicitly opened back stays
 *   until Back, whatever the pointer does; an explicit Back suppresses
 *   hover auto-flip until the pointer leaves and re-enters.
 */

export type Face = "front" | "back";

export type FlipState = {
  face: Face;
  /** The back was opened with Details — only Back undoes it. */
  explicit: boolean;
  hovering: boolean;
  focusWithin: boolean;
  menuOpen: boolean;
  pressing: boolean;
  /** Set by an explicit Back while the pointer is inside; cleared when it leaves. */
  hoverSuppressed: boolean;
  /** `(hover: hover) and (pointer: fine)` — false on touch-only devices. */
  hoverEnabled: boolean;
};

export type FlipEvent =
  | { type: "pointerEnter" }
  | { type: "pointerLeave" }
  | { type: "focusIn" }
  | { type: "focusOut" }
  | { type: "menu"; open: boolean }
  | { type: "press"; down: boolean }
  | { type: "details" }
  | { type: "back" }
  | { type: "hoverCapability"; enabled: boolean }
  | { type: "hoverTimer" }
  | { type: "graceTimer" };

export const HOVER_FLIP_MS = 700;
export const LEAVE_GRACE_MS = 400;
/** Rotation duration — between the --duration-panel (250ms) and the ~350ms upper bound for a surface turning over. */
export const FLIP_MS = 300;

export const INITIAL_FLIP_STATE: FlipState = {
  face: "front",
  explicit: false,
  hovering: false,
  focusWithin: false,
  menuOpen: false,
  pressing: false,
  hoverSuppressed: false,
  hoverEnabled: false,
};

export type PendingTimer = "hover" | "grace" | null;

/** Which timer (if any) the current state calls for — the controller keeps exactly this one running. */
export function pendingTimer(s: FlipState): PendingTimer {
  if (
    s.face === "front" &&
    s.hoverEnabled &&
    s.hovering &&
    !s.hoverSuppressed &&
    !s.focusWithin &&
    !s.menuOpen &&
    !s.pressing
  ) {
    return "hover";
  }
  if (s.face === "back" && !s.explicit && !s.hovering && !s.focusWithin && !s.menuOpen) return "grace";
  return null;
}

export function flipReducer(s: FlipState, e: FlipEvent): FlipState {
  switch (e.type) {
    case "pointerEnter":
      return s.hovering ? s : { ...s, hovering: true };
    case "pointerLeave":
      return { ...s, hovering: false, hoverSuppressed: false };
    case "focusIn":
      return s.focusWithin ? s : { ...s, focusWithin: true };
    case "focusOut":
      return s.focusWithin ? { ...s, focusWithin: false } : s;
    case "menu":
      return s.menuOpen === e.open ? s : { ...s, menuOpen: e.open };
    case "press":
      return s.pressing === e.down ? s : { ...s, pressing: e.down };
    case "details":
      return { ...s, face: "back", explicit: true };
    case "back":
      return { ...s, face: "front", explicit: false, hoverSuppressed: s.hovering };
    case "hoverCapability":
      return s.hoverEnabled === e.enabled ? s : { ...s, hoverEnabled: e.enabled };
    // Timers re-check their own condition, so a stale fire is a no-op.
    case "hoverTimer":
      return pendingTimer(s) === "hover" ? { ...s, face: "back", explicit: false } : s;
    case "graceTimer":
      return pendingTimer(s) === "grace" ? { ...s, face: "front" } : s;
  }
}

export type FlipController = {
  dispatch: (e: FlipEvent) => void;
  getState: () => FlipState;
  /** Clears any running timer; later dispatches are ignored. */
  dispose: () => void;
};

/**
 * Holds the state and keeps at most one timer — the one `pendingTimer`
 * asks for — running. Any state change that alters which timer is
 * wanted (leave, focus, menu, press, Details/Back) clears the old one
 * first; a state change that still wants the same timer leaves it
 * running, so hover time stays continuous.
 */
export function createFlipController({
  onChange,
  initial = INITIAL_FLIP_STATE,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
}: {
  onChange: (s: FlipState) => void;
  initial?: FlipState;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
}): FlipController {
  let state = initial;
  let timer: { kind: Exclude<PendingTimer, null>; id: ReturnType<typeof setTimeout> } | null = null;
  let disposed = false;

  function sync() {
    const want = pendingTimer(state);
    if (timer?.kind === want) return;
    if (timer) clearTimer(timer.id);
    timer = null;
    if (!want) return;
    const id = setTimer(
      () => {
        timer = null;
        dispatch({ type: want === "hover" ? "hoverTimer" : "graceTimer" });
      },
      want === "hover" ? HOVER_FLIP_MS : LEAVE_GRACE_MS,
    );
    timer = { kind: want, id };
  }

  function dispatch(e: FlipEvent) {
    if (disposed) return;
    const next = flipReducer(state, e);
    if (next !== state) {
      state = next;
      onChange(state);
    }
    sync();
  }

  sync();
  return {
    dispatch,
    getState: () => state,
    dispose() {
      disposed = true;
      if (timer) clearTimer(timer.id);
      timer = null;
    },
  };
}

/**
 * How a face is exposed. A hidden face is inert *and* aria-hidden at
 * once (aria-hidden covers Safari releases with patchy `inert`), but it
 * stays painted (`invisible` only once settled) while the card is still
 * turning, so the face rotating away doesn't vanish mid-turn.
 */
export function faceExposure(isShown: boolean, moving: boolean): { inert: boolean; ariaHidden: boolean; invisible: boolean } {
  return { inert: !isShown, ariaHidden: !isShown, invisible: !isShown && !moving };
}

/** ArrowDown/ArrowUp movement through a menu's items, wrapping — the same behaviour as components/review/RowMenu. -1 = nothing focused yet. */
export function nextMenuIndex(current: number, count: number, key: "ArrowDown" | "ArrowUp"): number {
  if (count === 0) return -1;
  if (current < 0) return key === "ArrowDown" ? 0 : count - 1;
  return key === "ArrowDown" ? (current + 1) % count : (current - 1 + count) % count;
}
