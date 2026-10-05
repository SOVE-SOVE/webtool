"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  actionResultToast,
  claimAction,
  isToastActionShortcut,
  newestActionToast,
  normaliseToastOptions,
  pauseTimer,
  pushToast,
  removeToast,
  resumeTimer,
  startTimer,
  timerDelay,
  toastDuration,
  type ToastEntry,
  type ToastOptions,
  type ToastTimer,
  type ToastTone,
} from "@/lib/toastQueue";

/**
 * `showToast("Saved")`, `showToast("Couldn't save", "error")`, or — for
 * something the user can take back —
 * `showToast("Marked complete", { key, action: { label: "Undo", onAction } })`.
 * Returns a function that dismisses that toast early (e.g. when the screen
 * that could apply its Undo goes away).
 */
type ShowToast = (message: string, toneOrOptions?: ToastTone | ToastOptions) => () => void;

const ToastContext = createContext<ShowToast | null>(null);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select");
}

/**
 * Fire-and-forget success/error banners: `showToast("Removed from Planning")`.
 * Mount once near the app root (dashboard layout), same placement as
 * ConfirmProvider — every page under it can call useToast().
 *
 * A toast may carry one action (Undo). It is a real button: it never takes
 * focus when the toast appears, and Ctrl/Cmd+Z (outside a text field) moves
 * focus to the newest one — Enter/Space then presses it, Escape dismisses
 * the toast and hands focus back. A toast with an action stays longer and
 * holds its timer while hovered or focused. Pressing the action dismisses
 * the toast, runs the handler once, and reports how it went.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const idRef = useRef(0);
  const claimedRef = useRef<Set<number>>(new Set());
  const actionButtonsRef = useRef<Map<number, HTMLButtonElement>>(new Map());
  // Where focus was before the shortcut moved it onto a toast's action.
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => removeToast(prev, id));
  }, []);

  const showToast = useCallback<ShowToast>(
    (message, toneOrOptions) => {
      const options = normaliseToastOptions(toneOrOptions);
      const id = ++idRef.current;
      const entry: ToastEntry = {
        id,
        message,
        tone: options.tone ?? "success",
        action: options.action,
        duration: toastDuration(options),
        key: options.key,
      };
      setToasts((prev) => pushToast(prev, entry));
      return () => dismiss(id);
    },
    [dismiss],
  );

  // Focus goes back where it came from when the toast it was moved onto
  // goes away by the user's own doing (pressed, or Escape).
  const restoreFocus = useCallback((id: number) => {
    const button = actionButtonsRef.current.get(id);
    const previous = returnFocusRef.current;
    returnFocusRef.current = null;
    if (button && document.activeElement === button && previous?.isConnected) previous.focus();
  }, []);

  const runAction = useCallback(
    (toast: ToastEntry) => {
      if (!toast.action || !claimAction(claimedRef.current, toast.id)) return;
      restoreFocus(toast.id);
      dismiss(toast.id);
      const { onAction } = toast.action;
      void (async () => {
        let result: { message: string; tone: ToastTone };
        try {
          result = actionResultToast({ ok: true, message: await onAction() });
        } catch (error) {
          result = actionResultToast({ ok: false, error });
        }
        showToast(result.message, result.tone);
      })();
    },
    [dismiss, restoreFocus, showToast],
  );

  const actionToast = newestActionToast(toasts);
  const actionToastId = actionToast?.id ?? null;
  useEffect(() => {
    if (actionToastId === null) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (!isToastActionShortcut(e, isTypingTarget(e.target))) return;
      const button = actionButtonsRef.current.get(actionToastId as number);
      if (!button) return;
      e.preventDefault();
      if (document.activeElement !== button) {
        returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        // Reached by keyboard, so it shows its focus ring even if the last
        // thing the user did before the shortcut was a click.
        button.focus({ focusVisible: true } as FocusOptions);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [actionToastId]);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      {/* Announced from here, once per toast — the visible stack below is
          deliberately not a live region, so a toast's button isn't read
          out as part of the message and then again as a control. */}
      <div className="sr-only" role="status" aria-live="polite">
        {toasts.map((t) => (
          <p key={t.id}>
            {t.message}
            {t.action ? `. ${t.action.label} available: press Control or Command Z to reach it.` : ""}
          </p>
        ))}
      </div>
      {/* Sits 1rem above the dashboard's bottom nav (always present —
          see `--app-bottom-nav-h` in globals.css) instead of over it, and
          above drawers/modals (z-50) so an action stays pressable while
          one is open; tooltips (z-60) still go over it. Only the toasts
          themselves take pointer events. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--app-bottom-nav-h)+1rem)] z-[55] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <ToastItem
            key={t.id}
            toast={t}
            onDismiss={dismiss}
            onAction={runAction}
            onEscape={(id) => {
              restoreFocus(id);
              dismiss(id);
            }}
            registerAction={(id, el) => {
              if (el) actionButtonsRef.current.set(id, el);
              else actionButtonsRef.current.delete(id);
            }}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({
  toast,
  onDismiss,
  onAction,
  onEscape,
  registerAction,
}: {
  toast: ToastEntry;
  onDismiss: (id: number) => void;
  onAction: (toast: ToastEntry) => void;
  onEscape: (id: number) => void;
  registerAction: (id: number, el: HTMLButtonElement | null) => void;
}) {
  const { id, duration, action } = toast;
  const timerRef = useRef<ToastTimer | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heldRef = useRef({ hover: false, focus: false });

  const schedule = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    if (!timerRef.current) return;
    const delay = timerDelay(timerRef.current, Date.now());
    if (delay !== null) timeoutRef.current = setTimeout(() => onDismiss(id), delay);
  }, [id, onDismiss]);

  useEffect(() => {
    timerRef.current = startTimer(duration, Date.now());
    schedule();
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [duration, schedule]);

  // Only a toast with an action holds its timer — a plain one has nothing
  // to reach for, and keeps its fixed lifetime.
  function setHeld(kind: "hover" | "focus", value: boolean) {
    if (!action || !timerRef.current) return;
    heldRef.current[kind] = value;
    const held = heldRef.current.hover || heldRef.current.focus;
    timerRef.current = held ? pauseTimer(timerRef.current, Date.now()) : resumeTimer(timerRef.current, Date.now());
    schedule();
  }

  const tone = toast.tone === "error" ? "bg-danger text-danger-fg" : "bg-accent text-accent-fg";

  if (!action) {
    return (
      <div className={`animate-rise-in pointer-events-auto max-w-sm rounded-md px-4 py-2 text-sm shadow-lg ${tone}`}>
        {toast.message}
      </div>
    );
  }

  return (
    <div
      className={`animate-rise-in pointer-events-auto flex max-w-sm items-center gap-1 rounded-md pl-4 pr-1 text-sm shadow-lg ${tone}`}
      // A touch has no "leave", so it must not hold the timer open.
      onPointerEnter={(e) => e.pointerType !== "touch" && setHeld("hover", true)}
      onPointerLeave={() => setHeld("hover", false)}
      onFocus={() => setHeld("focus", true)}
      onBlur={() => setHeld("focus", false)}
    >
      <span className="min-w-0 py-2">{toast.message}</span>
      <button
        ref={(el) => registerAction(id, el)}
        type="button"
        onClick={() => onAction(toast)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          // Dismisses this toast only — not whatever dialog is open behind it.
          e.stopPropagation();
          e.nativeEvent.stopImmediatePropagation();
          onEscape(id);
        }}
        title={`${action.label} (Ctrl/⌘ Z moves focus here)`}
        className="min-h-11 shrink-0 rounded px-3 font-semibold underline underline-offset-2 transition-opacity duration-fast ease-standard hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current active:opacity-70 motion-reduce:transition-none sm:min-h-9"
      >
        {action.label}
      </button>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
