"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type ClientChecklist, type User } from "@/lib/api";
import { Disclosure } from "@/components/ui/Disclosure";
import { TaskChecklistList } from "@/components/checklists/TaskChecklistList";

/**
 * Client Setup & Delivery checklist (docs/05_DECISIONS.md) — one
 * "Client setup" list for the business/contact task shared across
 * however many projects this client has, then one full "Delivery"
 * list per project, each with its own progress bar so it's always
 * unambiguous which project a bar refers to. Completing one project's
 * tasks never touches another's — they're entirely separate rows.
 */
export function ChecklistSection({ clientId }: { clientId: string }) {
  const [checklist, setChecklist] = useState<ClientChecklist | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .getClientChecklist(clientId)
      .then((c) => {
        setError(null);
        setChecklist(c);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load the checklist."));
  }

  useEffect(load, [clientId]);
  useEffect(() => {
    api.listUsers().then(setUsers).catch(() => {});
  }, []);

  if (error) {
    return (
      <section className="mt-8">
        <h2 className="text-sm font-semibold text-fg">Client Setup &amp; Delivery</h2>
        <p className="mt-2 text-error">{error}</p>
      </section>
    );
  }
  if (!checklist) return null;

  const multipleProjects = checklist.projects.length > 1;

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-fg">Client Setup &amp; Delivery</h2>

      <div className="mt-3 rounded-md border border-border p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Client setup</h3>
        <div className="mt-2">
          <TaskChecklistList
            items={checklist.client_items}
            progress={checklist.client_progress}
            nextAction={checklist.client_next_action}
            users={users}
            updateItem={(itemId, patch) => api.updateChecklistItem(itemId, patch)}
            addItem={(title, assignedUserId) =>
              api.addChecklistItem(clientId, { title, project_id: null, assigned_user_id: assignedUserId })
            }
            reorderItems={(items) => api.reorderChecklistItems(clientId, { items })}
            removeItem={(itemId) => api.removeChecklistItem(itemId)}
            fetchHistory={(itemId) => api.listActivity({ entity_type: "client_checklist_item", entity_id: itemId })}
            onUpdated={setChecklist}
          />
        </div>
      </div>

      {checklist.projects.length === 0 && (
        <p className="mt-3 text-sm text-fg-subtle">No projects yet — delivery tasks appear once one starts.</p>
      )}

      {checklist.projects.map((section) =>
        multipleProjects ? (
          <Disclosure
            key={section.project_id}
            title={`Delivery — ${section.project_name}`}
            hint={
              section.progress.required.total === 0
                ? "No applicable tasks"
                : `Required: ${section.progress.required.completed} of ${section.progress.required.total} complete`
            }
          >
            <TaskChecklistList
              items={section.items}
              progress={section.progress}
              nextAction={section.next_action}
              users={users}
              updateItem={(itemId, patch) => api.updateChecklistItem(itemId, patch)}
              addItem={(title, assignedUserId) =>
                api.addChecklistItem(clientId, { title, project_id: section.project_id, assigned_user_id: assignedUserId })
              }
              reorderItems={(items) => api.reorderChecklistItems(clientId, { items })}
              removeItem={(itemId) => api.removeChecklistItem(itemId)}
              fetchHistory={(itemId) => api.listActivity({ entity_type: "client_checklist_item", entity_id: itemId })}
              onUpdated={setChecklist}
            />
          </Disclosure>
        ) : (
          <div key={section.project_id} className="mt-3 rounded-md border border-border p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Delivery — {section.project_name}
            </h3>
            <div className="mt-2">
              <TaskChecklistList
                items={section.items}
                progress={section.progress}
                nextAction={section.next_action}
                users={users}
                updateItem={(itemId, patch) => api.updateChecklistItem(itemId, patch)}
                addItem={(title, assignedUserId) =>
                  api.addChecklistItem(clientId, { title, project_id: section.project_id, assigned_user_id: assignedUserId })
                }
                reorderItems={(items) => api.reorderChecklistItems(clientId, { items })}
                removeItem={(itemId) => api.removeChecklistItem(itemId)}
                fetchHistory={(itemId) => api.listActivity({ entity_type: "client_checklist_item", entity_id: itemId })}
                onUpdated={setChecklist}
              />
            </div>
          </div>
        ),
      )}
    </section>
  );
}
