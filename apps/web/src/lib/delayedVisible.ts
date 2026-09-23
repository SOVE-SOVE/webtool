/**
 * The pure pieces behind `useDelayedVisible`
 * (components/ui/SectionLoadingIndicator.tsx) — split out so its timing
 * and cleanup behaviour is unit-testable without rendering a React
 * component. This repo's tests run as plain `vitest run` in a Node
 * environment with no DOM/testing-library set up (see
 * vitest.config.mts), so a hook itself can't be invoked directly in a
 * test — only what it's built from can. The hook is a thin
 * `useState`/`useEffect` wrapper around these two functions; nothing
 * here reimplements or reinterprets its behaviour, it *is* the
 * behaviour (see recentChanges.ts/useRecentChanges.ts for the same
 * split, already established elsewhere in this codebase).
 */

/**
 * The hook's "hide the instant `active` goes false" rule, applied
 * during render (no timer involved): there is no minimum display time
 * once shown, and this never turns visibility on by itself — only
 * `scheduleDelayedShow` below does that.
 */
export function visibleOnActiveChange(active: boolean, current: boolean): boolean {
  return active ? current : false;
}

/**
 * Schedules `onShow` to run once `delayMs` has elapsed, returning the
 * matching cancel/cleanup function — call it (as a `useEffect`'s
 * cleanup does, on `active`/`delayMs` changing or on unmount) to cancel
 * the pending show, in which case `onShow` never runs, even once that
 * much real time goes by. A fast load that finishes and unmounts (or
 * flips `active` false) before `delayMs` elapses therefore never flashes
 * the loading UI at all — this is the one function responsible for
 * that.
 */
export function scheduleDelayedShow(delayMs: number, onShow: () => void): () => void {
  const timer = setTimeout(onShow, delayMs);
  return () => clearTimeout(timer);
}
