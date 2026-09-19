"use client";

import { useEffect, useRef } from "react";

const EVENT = "wdos:today-data-changed";

/**
 * The Today workspace keeps its Overview / Tasks / Calendar tabs mounted
 * so each keeps its own filters, month and drafts (see
 * `dashboard/page.tsx`). That means a change made in one tab (a task
 * ticked off, a meeting rescheduled) would leave the others stale, so
 * whichever tab made the change announces it here and the others reload.
 * A plain window event: no shared store, and nothing to unsubscribe from
 * if the tabs are ever opened standalone (the event just has no listeners).
 */
export type TodayDataSource = "overview" | "tasks" | "calendar";

/** Announces a change. `source` is the tab that made it — it already
 * refreshed its own state, so it ignores its own announcement (see
 * `useOnTodayDataChanged`); every other tab reloads. */
export function notifyTodayDataChanged(source?: TodayDataSource): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<TodayDataSource | undefined>(EVENT, { detail: source }));
}

/** Registers `listener` for change notifications (called with the source
 * tab, if any); returns the function that removes it. Framework-free so
 * it can be unit-tested without a DOM renderer — `useOnTodayDataChanged`
 * is a thin wrapper around it. */
export function subscribeTodayDataChanged(listener: (source?: TodayDataSource) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<TodayDataSource | undefined>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

/** Awaits a mutation and announces the change only if it succeeded — a
 * rejected request rethrows untouched and notifies nobody, so the other
 * tabs never reload for a change that didn't happen. */
export async function notifyAfter<T>(mutation: Promise<T>, source?: TodayDataSource): Promise<T> {
  const result = await mutation;
  notifyTodayDataChanged(source);
  return result;
}

/** Calls `reload` whenever a tab *other than* `self` reports a change
 * (the sender already refreshed its own state); returns the unsubscribe.
 * `reload` should refresh data only, never touch form, filter or
 * calendar-position state — which is why those survive a notification. */
export function subscribeToOtherTabs(self: TodayDataSource, reload: () => void): () => void {
  return subscribeTodayDataChanged((source) => {
    if (source !== self) reload();
  });
}

/** Hook wrapper: always calls the latest `reload`, subscribes once. */
export function useOnTodayDataChanged(self: TodayDataSource, reload: () => void): void {
  const ref = useRef(reload);
  useEffect(() => {
    ref.current = reload;
  });
  useEffect(() => subscribeToOtherTabs(self, () => ref.current()), [self]);
}
