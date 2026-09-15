"use client";

import { useEffect, useState } from "react";

export type Density = "comfortable" | "compact";

const DENSITY_KEY = "wdos-density";

/**
 * Shared list-density preference (Leads/Planning/Projects), same
 * localStorage-in-a-mount-effect pattern as ThemeProvider — read after
 * mount (not a lazy initializer) to avoid an SSR/first-paint mismatch.
 * A plain hook, not a Context: every page reading/writing the same key
 * stays in sync across page loads without needing cross-tab reactivity.
 */
export function useDensity(): [Density, (next: Density) => void] {
  const [density, setDensityState] = useState<Density>("comfortable");

  useEffect(() => {
    const stored = localStorage.getItem(DENSITY_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored === "compact" || stored === "comfortable") setDensityState(stored);
  }, []);

  function setDensity(next: Density) {
    setDensityState(next);
    localStorage.setItem(DENSITY_KEY, next);
  }

  return [density, setDensity];
}
