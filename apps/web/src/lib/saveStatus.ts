/**
 * Save-indicator rules — the pure half of every "Saving… / Saved" readout
 * (see components/ui/SaveStatus.tsx). Kept free of React so the rules that
 * matter are unit-tested: "Saved" only once the server confirmed it, never
 * while anything newer is unsaved or still in flight, and a failure stays
 * on screen until something replaces it.
 */
import type { SaveStatusValue } from "../components/ui/SaveStatus";

export type SaveOutcome = "none" | "saved" | "error";

/**
 * What the indicator should say. Order matters: a request in flight
 * always reads "saving"; a failure outranks "unsaved" (the edit that
 * failed is still unsaved — the error is the more useful thing to say);
 * and "saved" only shows when nothing newer is waiting (`dirty`).
 */
export function deriveSaveStatus({
  saving,
  outcome,
  dirty,
}: {
  saving: boolean;
  outcome: SaveOutcome;
  dirty: boolean;
}): SaveStatusValue {
  if (saving) return "saving";
  if (outcome === "error") return "error";
  if (dirty) return "dirty";
  return outcome === "saved" ? "saved" : "idle";
}

/**
 * One editor saving one record, where only the latest request counts.
 * `latest` identifies the newest request; an older one that settles
 * afterwards is ignored. `edits`/`sentEdits` count changes made, and how
 * many of them the newest request carried — so a save that lands after
 * the operator kept typing isn't mistaken for "everything is saved".
 */
export type LatestSave = {
  latest: number;
  saving: boolean;
  outcome: SaveOutcome;
  edits: number;
  sentEdits: number;
};

export const IDLE_LATEST_SAVE: LatestSave = { latest: 0, saving: false, outcome: "none", edits: 0, sentEdits: 0 };

/** A save starts. Its id is the returned state's `latest`. */
export function beginLatestSave(s: LatestSave): LatestSave {
  return { ...s, latest: s.latest + 1, saving: true, outcome: "none", sentEdits: s.edits };
}

/** A save finished. Returns `s` itself, untouched, when `id` is no longer
 * the latest request — callers can compare by identity to tell. */
export function settleLatestSave(s: LatestSave, id: number, ok: boolean): LatestSave {
  if (id !== s.latest || !s.saving) return s;
  return { ...s, saving: false, outcome: ok ? "saved" : "error" };
}

/** The operator changed something. Clears a shown result (it described
 * the previous value), but never hides a request that's still running. */
export function touchLatestSave(s: LatestSave): LatestSave {
  return { ...s, edits: s.edits + 1, outcome: s.saving ? s.outcome : "none" };
}

/** The editor now points at something else (another record, a cancel, a
 * discard). Whatever is still in flight no longer belongs to it. */
export function resetLatestSave(s: LatestSave): LatestSave {
  return { ...IDLE_LATEST_SAVE, latest: s.latest + 1 };
}

/** Whether anything was edited after the newest request was sent. */
export function hasNewerEdits(s: LatestSave): boolean {
  return s.edits !== s.sentEdits;
}

/**
 * Several independent saves that can overlap (add this, remove that).
 * Reads "saving" until every one has settled, and "saved" only if none
 * of them failed. A new save starting from rest begins a fresh run, the
 * same way each action already clears the previous action's error.
 */
export type SaveBurst = { pending: number; outcome: SaveOutcome };

export const IDLE_SAVE_BURST: SaveBurst = { pending: 0, outcome: "none" };

export function beginBurstSave(b: SaveBurst): SaveBurst {
  return { pending: b.pending + 1, outcome: b.pending === 0 ? "none" : b.outcome };
}

export function settleBurstSave(b: SaveBurst, ok: boolean): SaveBurst {
  return {
    pending: Math.max(0, b.pending - 1),
    outcome: !ok || b.outcome === "error" ? "error" : "saved",
  };
}
