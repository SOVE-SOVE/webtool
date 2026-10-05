"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CELEBRATION_WINDOW_MS } from "./completionFeedback";

/**
 * Holds the one task whose completion the user just made and the server
 * just confirmed (see `completedByUser`), so its check can play the
 * completion acknowledgement once. `celebrate(id)` marks it; `settle()` —
 * wired to the check's `onAnimationEnd` — clears it, so a row that
 * remounts later (a tab or filter change) never replays it. It also
 * clears by itself after a short window, for a row that never appears
 * and under reduced motion, where no animation ends.
 */
export function useCompletionCelebration() {
  const [celebratingId, setCelebratingId] = useState<string | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const settle = useCallback(() => {
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = null;
    setCelebratingId(null);
  }, []);

  const celebrate = useCallback((id: string) => {
    if (timeout.current) clearTimeout(timeout.current);
    setCelebratingId(id);
    timeout.current = setTimeout(() => setCelebratingId(null), CELEBRATION_WINDOW_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (timeout.current) clearTimeout(timeout.current);
    };
  }, []);

  return { celebratingId, celebrate, settle };
}
