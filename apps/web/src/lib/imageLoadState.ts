/**
 * The pure state machine behind `ScreenshotImage`
 * (components/ui/ScreenshotImage.tsx) — split out so it is unit-testable
 * in this repo's DOM-less vitest setup (see delayedVisible.ts for the
 * same split).
 *
 * One state per `src`:
 *   loading        nothing to show yet — the image is transparent and
 *                  the caller's neutral box shows through.
 *   loaded-cached  already complete when first looked at (browser cache,
 *                  or it loaded before React attached a handler) — shown
 *                  at once, no fade.
 *   loaded-fade    finished loading while we were watching — fades in
 *                  once.
 *   error          failed — the caller's fallback replaces the image.
 *
 * Every event carries the `src` it is about; an event for a different
 * `src` than the state's starts that `src` afresh, so a new capture (or a
 * changed cache-busting param) is always a new attempt and a stale event
 * can never mark the current image loaded or failed.
 */
export type ImageLoadPhase = "loading" | "loaded-cached" | "loaded-fade" | "error";

export interface ImageLoadState {
  src: string;
  phase: ImageLoadPhase;
}

export type ImageLoadEvent =
  /** The element as found when it mounted or its `src` changed, read before paint. */
  | { type: "probe"; src: string; complete: boolean; naturalWidth: number }
  | { type: "load"; src: string }
  | { type: "error"; src: string };

/**
 * `knownLoaded`: this exact `src` already loaded successfully earlier in
 * this page session (see `rememberLoaded`), so a remount — a card
 * returning after a filter change — starts visible instead of fading in
 * a second time. The browser paints it as soon as it has decoded it; if
 * it fails this time, `error` still takes over.
 */
export function initialImageLoadState(src: string, knownLoaded = false): ImageLoadState {
  return { src, phase: knownLoaded ? "loaded-cached" : "loading" };
}

export function reduceImageLoad(state: ImageLoadState, event: ImageLoadEvent, knownLoaded = false): ImageLoadState {
  const current = state.src === event.src ? state : initialImageLoadState(event.src, knownLoaded);
  const isLoaded = current.phase === "loaded-cached" || current.phase === "loaded-fade";
  switch (event.type) {
    case "probe":
      if (!event.complete) return current;
      // Complete with no pixels is the browser's "broken" state.
      if (event.naturalWidth === 0) return current.phase === "error" ? current : { ...current, phase: "error" };
      return current.phase === "loading" ? { ...current, phase: "loaded-cached" } : current;
    case "load":
      // Never re-enter a loaded phase (that would replay the fade). A
      // `load` after `error` for the same src recovers: the browser has
      // the final say over an early "broken" reading.
      return isLoaded ? current : { ...current, phase: "loaded-fade" };
    case "error":
      return current.phase === "error" ? current : { ...current, phase: "error" };
  }
}

/** Whether the phase should render with the opacity transition. */
export function imageShouldFade(phase: ImageLoadPhase): boolean {
  return phase === "loaded-fade";
}

/**
 * Sources that have loaded successfully in this page session. Bounded:
 * the oldest entry is dropped past `LOADED_SRC_LIMIT` (losing one only
 * costs that image a second fade).
 */
export const LOADED_SRC_LIMIT = 500;
const loadedSrcs = new Set<string>();

export function rememberLoaded(src: string, store: Set<string> = loadedSrcs, limit = LOADED_SRC_LIMIT): void {
  if (store.has(src)) return;
  store.add(src);
  if (store.size > limit) {
    const oldest = store.values().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
}

export function hasLoadedBefore(src: string, store: Set<string> = loadedSrcs): boolean {
  return store.has(src);
}
