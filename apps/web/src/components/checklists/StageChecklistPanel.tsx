"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type StageChecklist, type StageChecklistOwnerType, type User } from "@/lib/api";
import { Disclosure } from "@/components/ui/Disclosure";
import { TaskChecklistList } from "./TaskChecklistList";

/**
 * Loads a stage checklist and the workspace users its items can be
 * assigned to. Shared by `StageChecklistPanel` (the collapsible
 * version every stage page uses), the discovered-business review
 * brief, and Planning's own step process (which needs the same
 * progress/next-action to compute its step statuses, before its own
 * `planning` has necessarily loaded) — all three need the same state
 * without a second fetch.
 *
 * `ownerId` may be passed empty (a caller that hasn't loaded its own
 * owner record yet, so it can still call this hook unconditionally,
 * ahead of any early return) — the fetch is simply held off until a
 * real id shows up, rather than firing against an invalid path.
 */
export function useStageChecklist(ownerType: StageChecklistOwnerType, ownerId: string) {
  const [checklist, setChecklist] = useState<StageChecklist | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);

  function load() {
    if (!ownerId) return;
    api
      .getStageChecklist(ownerType, ownerId)
      .then((c) => {
        setError(null);
        setChecklist(c);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load the checklist."));
  }

  useEffect(load, [ownerType, ownerId]);
  useEffect(() => {
    api.listUsers().then(setUsers).catch(() => {});
  }, []);

  // `reload` — for callers whose own action changes an AUTOMATIC item
  // server-side (e.g. approving a Build Brief) and need the fresh status.
  return { checklist, users, error, setChecklist, reload: load };
}

/** The editable checklist itself — no Disclosure/card chrome around it. */
export function StageChecklistBody({
  ownerType,
  ownerId,
  checklist,
  users,
  onUpdated,
}: {
  ownerType: StageChecklistOwnerType;
  ownerId: string;
  checklist: StageChecklist;
  users: User[];
  onUpdated: (next: StageChecklist) => void;
}) {
  return (
    <TaskChecklistList
      items={checklist.items}
      progress={checklist.progress}
      nextAction={checklist.next_action}
      users={users}
      updateItem={(itemId, patch) => api.updateStageChecklistItem(itemId, patch)}
      addItem={(title, assignedUserId) => api.addStageChecklistItem(ownerType, ownerId, { title, assigned_user_id: assignedUserId })}
      reorderItems={(items) => api.reorderStageChecklistItems(ownerType, ownerId, { items })}
      removeItem={(itemId) => api.removeStageChecklistItem(itemId)}
      fetchHistory={(itemId) => api.listActivity({ entity_type: "stage_checklist_item", entity_id: itemId })}
      onUpdated={onUpdated}
    />
  );
}

/** The `progress.required` hint every closed checklist header shows —
 * exported so a caller that already holds a `StageChecklist` via the
 * lifted `useStageChecklist` above (Planning's step process) can show
 * the exact same text without re-deriving it. */
export function stageChecklistHint(checklist: StageChecklist): string {
  const { progress } = checklist;
  return progress.required.total === 0
    ? "No applicable tasks"
    : `Required: ${progress.required.completed} of ${progress.required.total} complete`;
}

/**
 * The Disclosure-wrapped body — split out of `StageChecklistPanel` so a
 * caller that already has `useStageChecklist`'s state (Planning's step
 * process, which also needs it to compute step statuses) can render the
 * exact same widget without a second fetch. `StageChecklistPanel` below
 * is this plus its own self-contained fetch, for every other caller.
 */
export function StageChecklistPanelView({
  ownerType,
  ownerId,
  title,
  checklist,
  users,
  error,
  onUpdated,
}: {
  ownerType: StageChecklistOwnerType;
  ownerId: string;
  title: string;
  checklist: StageChecklist | null;
  users: User[];
  error: string | null;
  onUpdated: (next: StageChecklist) => void;
}) {
  if (error) {
    return (
      <div className="mt-4 rounded-md border border-border p-4">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        <p className="mt-2 text-error">{error}</p>
      </div>
    );
  }
  if (!checklist) return null;

  return (
    <Disclosure title={title} hint={stageChecklistHint(checklist)}>
      <StageChecklistBody ownerType={ownerType} ownerId={ownerId} checklist={checklist} users={users} onUpdated={onUpdated} />
    </Disclosure>
  );
}

/**
 * A compact, collapsible "Stage Checklist" panel — one per pre-Client
 * stage (Discovery review, Lead, Planning, Project), reusing the Client
 * Setup & Delivery checklist's shape without needing a Client to exist
 * yet (docs/05_DECISIONS.md). Collapsed by default; the progress hint is
 * still fetched and shown on the closed header, same as the Client
 * page's own per-project Delivery Disclosures.
 */
export function StageChecklistPanel({
  ownerType,
  ownerId,
  title,
}: {
  ownerType: StageChecklistOwnerType;
  ownerId: string;
  title: string;
}) {
  const { checklist, users, error, setChecklist } = useStageChecklist(ownerType, ownerId);
  return (
    <StageChecklistPanelView
      ownerType={ownerType}
      ownerId={ownerId}
      title={title}
      checklist={checklist}
      users={users}
      error={error}
      onUpdated={setChecklist}
    />
  );
}
