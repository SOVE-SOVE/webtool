"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "wdos-clients-columns";

/** Secondary columns on the Clients Overview table — Client (business name + contact) and the actions column are always shown, never toggleable. */
export type ClientColumnKey = "websites" | "hosting" | "nextPayment" | "nextTask";

export const CLIENT_COLUMN_LABELS: Record<ClientColumnKey, string> = {
  websites: "Websites",
  hosting: "Hosting",
  nextPayment: "Next payment",
  nextTask: "Next task",
};

export const CLIENT_COLUMN_DEFAULTS: Record<ClientColumnKey, boolean> = {
  websites: true,
  hosting: true,
  nextPayment: true,
  nextTask: true,
};

function isValidColumns(value: unknown): value is Partial<Record<ClientColumnKey, boolean>> {
  return typeof value === "object" && value !== null;
}

/**
 * Per-operator column visibility for the Clients Overview table — same
 * localStorage-in-a-mount-effect pattern as useDensity.ts (read after
 * mount, not a lazy initializer, to avoid an SSR/first-paint mismatch).
 * Stored as a partial object merged over the defaults, so adding a new
 * toggleable column later doesn't require migrating anyone's saved
 * preference — it just shows up visible (the default) until they hide it.
 */
export function useClientColumns(): [Record<ClientColumnKey, boolean>, (next: Record<ClientColumnKey, boolean>) => void] {
  const [columns, setColumnsState] = useState<Record<ClientColumnKey, boolean>>(CLIENT_COLUMN_DEFAULTS);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return;
      const parsed: unknown = JSON.parse(stored);
      if (isValidColumns(parsed)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setColumnsState({ ...CLIENT_COLUMN_DEFAULTS, ...parsed });
      }
    } catch {
      // Malformed/unavailable storage — fall back to defaults silently.
    }
  }, []);

  function setColumns(next: Record<ClientColumnKey, boolean>) {
    setColumnsState(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable (private mode, quota) — preference just won't persist this session.
    }
  }

  return [columns, setColumns];
}
