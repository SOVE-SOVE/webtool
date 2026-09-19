"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type StageChecklist, type StageChecklistOwnerType, type User } from "@/lib/api";
import { Disclosure } from "@/components/ui/Disclosure";
import { TaskChecklistList } from "./TaskChecklistList";

/**
 * Loads a stage checklist and the workspace users its items can be
 * assigned to. Shared by `StageChecklistPanel` (the collapsible
 * version every stage page uses) and the discovered-business review
 * brief, which shows the progress on a card and the editable list in a
 * side panel — both need the same state without a second fetch.
 */
export function useStageChecklist(ownerType: StageChecklistOwnerType, ownerId: string) {
  const [checklist, setChecklist] = useState<StageChecklist | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);

  function load() {
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

  return { checklist, users, error, setChecklist };
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

  if (error) {
    return (
      <div className="mt-4 rounded-md border border-border p-4">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        <p className="mt-2 text-error">{error}</p>
      </div>
    );
  }
  if (!checklist) return null;

  const { progress } = checklist;
  const hint =
    progress.required.total === 0
      ? "No applicable tasks"
      : `Required: ${progress.required.completed} of ${progress.required.total} complete`;

  return (
    <Disclosure title={title} hint={hint}>
      <StageChecklistBody
        ownerType={ownerType}
        ownerId={ownerId}
        checklist={checklist}
        users={users}
        onUpdated={setChecklist}
      />
    </Disclosure>
  );
}
