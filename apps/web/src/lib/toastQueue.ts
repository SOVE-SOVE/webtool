/**
 * The pure pieces behind `ToastProvider` (components/ui/ToastProvider.tsx)
 * — the stack, the pausable auto-dismiss timer and the run-once guard on a
 * toast's action — split out so they are unit-testable without a DOM (see
 * lib/delayedVisible.ts for why this repo splits hooks/components this way).
 */

export type ToastTone = "success" | "error";

export type ToastAction = {
  /** Button text, e.g. "Undo". */
  label: string;
  /**
   * Runs once when the button is pressed. Resolve to report success — with
   * a string to replace the default "Restored" message — or throw an
   * `Error` whose message says why it couldn't be done.
   */
  onAction: () => void | string | Promise<void | string>;
};

export type ToastOptions = {
  tone?: ToastTone;
  action?: ToastAction;
  /** Auto-dismiss delay in ms. Defaults to `toastDuration`. */
  duration?: number;
  /**
   * Identifies what the toast is about (e.g. `task-done:<id>`). A newer
   * toast with the same key replaces the older one, so an Undo that a later
   * action on the same thing has made stale is no longer offered.
   */
  key?: string;
};

export type ToastEntry = {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
  duration: number;
  key?: string;
};

/** A plain toast's lifetime — unchanged from before actions existed. */
export const TOAST_DURATION_MS = 4000;
/** Longer when there is something to press: time to notice, reach and decide. */
export const TOAST_ACTION_DURATION_MS = 7000;
/** Most toasts on screen at once; the oldest gives way to a newer one. */
export const TOAST_STACK_LIMIT = 3;

export function toastDuration(options: Pick<ToastOptions, "action" | "duration">): number {
  if (options.duration !== undefined && options.duration > 0) return options.duration;
  return options.action ? TOAST_ACTION_DURATION_MS : TOAST_DURATION_MS;
}

/** `showToast(message, "error")` and `showToast(message, { tone: "error" })` are the same call. */
export function normaliseToastOptions(toneOrOptions?: ToastTone | ToastOptions): ToastOptions {
  if (toneOrOptions === undefined) return {};
  return typeof toneOrOptions === "string" ? { tone: toneOrOptions } : toneOrOptions;
}

/**
 * Adds a toast to the stack (newest last). One with the same `key` as the
 * newcomer is dropped — it has been superseded — and the stack is capped,
 * oldest first.
 */
export function pushToast(stack: ToastEntry[], next: ToastEntry, limit = TOAST_STACK_LIMIT): ToastEntry[] {
  const kept = next.key === undefined ? stack : stack.filter((t) => t.key !== next.key);
  const merged = [...kept, next];
  return merged.length > limit ? merged.slice(merged.length - limit) : merged;
}

export function removeToast(stack: ToastEntry[], id: number): ToastEntry[] {
  return stack.some((t) => t.id === id) ? stack.filter((t) => t.id !== id) : stack;
}

/** The newest toast that still offers an action — what the keyboard shortcut reaches. */
export function newestActionToast(stack: ToastEntry[]): ToastEntry | null {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    if (stack[i].action) return stack[i];
  }
  return null;
}

/**
 * A countdown that can be held: `remaining` is what is left when it is
 * paused; while running, `startedAt` is when the current stretch began.
 */
export type ToastTimer = { remaining: number; startedAt: number | null };

export function startTimer(duration: number, now: number): ToastTimer {
  return { remaining: duration, startedAt: now };
}

/** Hover or focus: stop counting, keeping what is left. */
export function pauseTimer(timer: ToastTimer, now: number): ToastTimer {
  if (timer.startedAt === null) return timer;
  return { remaining: Math.max(0, timer.remaining - (now - timer.startedAt)), startedAt: null };
}

/** Pointer and focus both gone: carry on from what was left. */
export function resumeTimer(timer: ToastTimer, now: number): ToastTimer {
  if (timer.startedAt !== null) return timer;
  return { remaining: timer.remaining, startedAt: now };
}

/** Ms until the toast should dismiss, or `null` while paused. */
export function timerDelay(timer: ToastTimer, now: number): number | null {
  if (timer.startedAt === null) return null;
  return Math.max(0, timer.remaining - (now - timer.startedAt));
}

/**
 * Run-once guard for a toast's action: the first claim of an id wins, so a
 * double click (or a click racing the keyboard) can't run it twice.
 */
export function claimAction(claimed: Set<number>, id: number): boolean {
  if (claimed.has(id)) return false;
  claimed.add(id);
  return true;
}

/** What the follow-up toast says once an action has settled. */
export function actionResultToast(
  outcome: { ok: true; message: string | void } | { ok: false; error: unknown },
): { message: string; tone: ToastTone } {
  if (outcome.ok) return { message: outcome.message || "Restored", tone: "success" };
  const reason = outcome.error instanceof Error ? outcome.error.message.trim() : "";
  return { message: reason || "Couldn't undo that.", tone: "error" };
}

/**
 * Whether a keydown is the "reach the toast's action" shortcut: Ctrl/Cmd+Z
 * with nothing else held, and not while typing — in a field that
 * combination is the browser's own text undo and must stay that.
 */
export function isToastActionShortcut(
  event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean },
  typing: boolean,
): boolean {
  if (typing) return false;
  if (event.altKey || event.shiftKey) return false;
  if (event.metaKey === event.ctrlKey) return false;
  return event.key.toLowerCase() === "z";
}
