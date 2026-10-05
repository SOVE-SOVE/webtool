/**
 * When a task's completion earns the small "done" acknowledgement (the
 * check popping / drawing in): only when this user asked to complete an
 * open task and the server confirmed it. Never for a reopen, a failed
 * request, a task that was already complete, or data that merely arrived
 * complete (first load, refetch, another row changing).
 */
export function completedByUser({
  wasDone,
  requestedDone,
  confirmedDone,
}: {
  /** The task's state when the user acted. */
  wasDone: boolean;
  /** What the user asked for. */
  requestedDone: boolean;
  /** What the server answered — `null` when the request failed. */
  confirmedDone: boolean | null;
}): boolean {
  return !wasDone && requestedDone && confirmedDone === true;
}

/**
 * How long a confirmed completion may wait for its row to show up as
 * done (some lists refetch first) before the acknowledgement is dropped.
 * The animation itself is `--duration-base`; see useCompletionCelebration.
 */
export const CELEBRATION_WINDOW_MS = 2000;
