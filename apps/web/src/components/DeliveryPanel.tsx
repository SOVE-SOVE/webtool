"use client";

import { useState } from "react";
import { api, ApiError, type DeliveryStatus } from "@/lib/api";

export function DeliveryPanel({
  projectId,
  deliveryStatus,
  onChanged,
}: {
  projectId: string;
  deliveryStatus: DeliveryStatus;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskBusyId, setTaskBusyId] = useState<string | null>(null);

  async function toggleTask(taskId: string, done: boolean) {
    setTaskBusyId(taskId);
    setError(null);
    try {
      await api.updateTask(taskId, { done: !done });
      onChanged();
    } catch {
      setError("Couldn't update that checklist item.");
    } finally {
      setTaskBusyId(null);
    }
  }

  async function deliver() {
    setBusy(true);
    setError(null);
    try {
      await api.deliverProject(projectId);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't mark this project delivered.");
    } finally {
      setBusy(false);
    }
  }

  if (deliveryStatus.already_delivered) {
    return (
      <div className="mt-3 border-t border-border pt-3 text-sm text-emerald-700">
        ✓ Delivered{deliveryStatus.latest_deployment_url ? ` — live at ${deliveryStatus.latest_deployment_url}` : ""}.
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Final delivery checklist</h3>
      {deliveryStatus.checklist.length === 0 ? (
        <p className="mt-1 text-sm text-fg-muted">
          Seeded automatically once this project&apos;s first deployment succeeds.
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {deliveryStatus.checklist.map((item) => (
            <li key={item.task_id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={item.done}
                disabled={taskBusyId === item.task_id}
                onChange={() => toggleTask(item.task_id, item.done)}
              />
              <span className={item.done ? "text-fg-subtle line-through" : "text-fg"}>{item.title}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={deliver}
          disabled={!deliveryStatus.can_deliver || busy}
          title={deliveryStatus.can_deliver ? undefined : `Missing: ${deliveryStatus.missing.join("; ")}`}
          className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {busy ? "Marking delivered…" : "Mark project delivered"}
        </button>
        {!deliveryStatus.can_deliver && deliveryStatus.missing.length > 0 && (
          <p className="text-sm text-fg-muted">Missing: {deliveryStatus.missing.join("; ")}</p>
        )}
        {error && <p className="text-error">{error}</p>}
      </div>
    </div>
  );
}
