"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  hasLoadedBefore,
  imageShouldFade,
  initialImageLoadState,
  reduceImageLoad,
  rememberLoaded,
  type ImageLoadEvent,
} from "@/lib/imageLoadState";

/**
 * A website screenshot/thumbnail `<img>` that loads calmly. It renders
 * only the image — the caller keeps its own box (aspect ratio or fixed
 * size, background, border, crop classes), which is what reserves the
 * space and shows through as the neutral placeholder while loading.
 *
 * - First load: transparent until `load`, then one short opacity fade.
 * - Already complete when mounted (browser cache, or loaded before React
 *   attached a handler): shown at once, no fade — checked in the ref
 *   callback, before paint.
 * - Failure (`error`, or complete with no pixels): the image is removed
 *   and `fallback` renders in its place — no broken-image icon, no
 *   retry. A changed `src` is a new attempt.
 * - The fade plays once per successful load of a `src`: re-renders,
 *   re-sorts and remounts of an image that already loaded don't replay
 *   it. Static under reduced motion.
 *
 * The state machine lives in lib/imageLoadState.ts.
 */
export function ScreenshotImage({
  src,
  alt,
  className = "",
  loading,
  fallback = null,
  onError,
}: {
  src: string;
  alt: string;
  /** Size/crop classes for the image itself (object-fit, radius, border). */
  className?: string;
  loading?: "lazy" | "eager";
  /** Rendered instead of the image once it has failed to load. */
  fallback?: ReactNode;
  /** Also told about a failure, for callers that keep their own state. */
  onError?: () => void;
}) {
  const [state, setState] = useState(() => initialImageLoadState(src, hasLoadedBefore(src)));
  // A new src starts over during render, so the previous src's phase is
  // never painted against the new image.
  const current = state.src === src ? state : initialImageLoadState(src, hasLoadedBefore(src));
  if (current !== state) setState(current);

  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });

  const apply = useCallback((event: ImageLoadEvent) => {
    if (event.type === "load") rememberLoaded(event.src);
    setState((prev) => reduceImageLoad(prev, event, hasLoadedBefore(event.src)));
  }, []);

  // Runs when the element mounts and again whenever `src` changes (the
  // callback's identity follows `src`), in the commit, before paint.
  const probe = useCallback(
    (el: HTMLImageElement | null) => {
      if (!el) return;
      const broken = el.complete && el.naturalWidth === 0;
      if (el.complete && !broken) rememberLoaded(src);
      apply({ type: "probe", src, complete: el.complete, naturalWidth: el.naturalWidth });
      if (broken) onErrorRef.current?.();
    },
    [src, apply],
  );

  if (current.phase === "error") return <>{fallback}</>;

  const visibility =
    current.phase === "loading"
      ? "opacity-0"
      : imageShouldFade(current.phase)
        ? "opacity-100 transition-opacity duration-base ease-out-calm motion-reduce:transition-none"
        : "";

  return (
    // eslint-disable-next-line @next/next/no-img-element -- screenshots come from authenticated API routes, not optimizable static assets
    <img
      ref={probe}
      src={src}
      alt={alt}
      loading={loading}
      onLoad={() => apply({ type: "load", src })}
      onError={() => {
        apply({ type: "error", src });
        onError?.();
      }}
      className={`${className} ${visibility}`.trim()}
    />
  );
}
