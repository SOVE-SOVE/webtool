"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  api,
  ApiError,
  ONBOARDING_CATEGORIES,
  type OnboardingCategory,
  type OnboardingChecklist,
  type OnboardingItem,
  type OnboardingItemStatus,
} from "@/lib/api";
import { categoryPercentComplete, formatCategoryLabel, groupItemsByCategory } from "@/lib/onboarding";

const STATUS_LABEL: Record<OnboardingItemStatus, string> = {
  pending: "Pending",
  done: "Done",
  not_applicable: "N/A",
};

export default function ProjectOnboardingPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [checklist, setChecklist] = useState<OnboardingChecklist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<OnboardingCategory | null>(null);
  const [newItemLabel, setNewItemLabel] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);

  function load() {
    api
      .getOnboardingChecklist(projectId)
      .then(setChecklist)
      .catch(() => setError("Couldn't load the onboarding checklist."));
  }

  useEffect(load, [projectId]);

  async function handleStatusChange(item: OnboardingItem, status: OnboardingItemStatus) {
    setBusyItemId(item.id);
    try {
      setChecklist(await api.updateOnboardingItem(item.id, { status }));
    } catch {
      setError("Couldn't update that item.");
    } finally {
      setBusyItemId(null);
    }
  }

  async function handleDelete(item: OnboardingItem) {
    setBusyItemId(item.id);
    try {
      setChecklist(await api.deleteOnboardingItem(item.id));
    } catch {
      setError("Couldn't remove that item.");
    } finally {
      setBusyItemId(null);
    }
  }

  async function handleAddItem(e: React.FormEvent, category: OnboardingCategory) {
    e.preventDefault();
    if (!newItemLabel.trim()) return;
    setAddError(null);
    try {
      setChecklist(await api.addOnboardingItem(projectId, { category, label: newItemLabel.trim() }));
      setAddingTo(null);
      setNewItemLabel("");
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : "Couldn't add that item.");
    }
  }

  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;
  if (!checklist) return <div className="p-6 text-sm text-neutral-500">Loading…</div>;

  const grouped = groupItemsByCategory(checklist.items);

  return (
    <div className="p-6">
      <Link href={`/dashboard/projects/${projectId}`} className="text-sm text-neutral-500 hover:underline">
        ← Back to project
      </Link>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">Onboarding checklist</h1>
          <p className="text-sm text-neutral-500">
            Not every project needs every step — mark an item N/A when it doesn&apos;t apply, or add one of
            your own under any category.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="h-2 w-40 overflow-hidden rounded-full bg-neutral-200">
            <div
              className="h-full rounded-full bg-neutral-900"
              style={{ width: `${checklist.percent_complete}%` }}
            />
          </div>
          <span className="text-sm font-medium text-neutral-900">{checklist.percent_complete}%</span>
        </div>
      </div>

      <div className="mt-6 space-y-6">
        {ONBOARDING_CATEGORIES.map((category) => {
          const items = grouped.get(category) ?? [];
          const categoryProgress = checklist.categories.find((c) => c.category === category);
          const percent = categoryProgress ? categoryPercentComplete(categoryProgress) : 0;

          return (
            <section key={category} className="border border-neutral-200">
              <div className="flex items-center justify-between gap-3 border-b border-neutral-200 bg-neutral-50 px-4 py-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-neutral-900">{formatCategoryLabel(category)}</h2>
                  {categoryProgress?.complete && items.length > 0 && (
                    <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                      Complete
                    </span>
                  )}
                </div>
                <span className="text-xs text-neutral-500">{percent}%</span>
              </div>

              <ul className="divide-y divide-neutral-200">
                {items.length === 0 && (
                  <li className="px-4 py-3 text-sm text-neutral-500">No items in this category.</li>
                )}
                {items.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                    <span
                      className={
                        item.status === "not_applicable"
                          ? "text-neutral-400 line-through"
                          : item.status === "done"
                            ? "text-neutral-500 line-through"
                            : "text-neutral-900"
                      }
                    >
                      {item.label}
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      <select
                        value={item.status}
                        disabled={busyItemId === item.id}
                        onChange={(e) => handleStatusChange(item, e.target.value as OnboardingItemStatus)}
                        className="rounded-md border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50"
                      >
                        {(Object.keys(STATUS_LABEL) as OnboardingItemStatus[]).map((status) => (
                          <option key={status} value={status}>
                            {STATUS_LABEL[status]}
                          </option>
                        ))}
                      </select>
                      {item.is_custom && (
                        <button
                          onClick={() => handleDelete(item)}
                          disabled={busyItemId === item.id}
                          className="text-xs text-neutral-400 hover:text-red-600 disabled:opacity-50"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>

              <div className="border-t border-neutral-200 px-4 py-2">
                {addingTo === category ? (
                  <form onSubmit={(e) => handleAddItem(e, category)} className="flex items-center gap-2">
                    <input
                      autoFocus
                      value={newItemLabel}
                      onChange={(e) => setNewItemLabel(e.target.value)}
                      placeholder="Describe the item"
                      className="flex-1 rounded-md border border-neutral-300 px-2 py-1 text-sm"
                    />
                    <button
                      type="submit"
                      className="rounded-md bg-neutral-900 px-3 py-1 text-xs font-medium text-white hover:bg-neutral-800"
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAddingTo(null);
                        setNewItemLabel("");
                        setAddError(null);
                      }}
                      className="text-xs text-neutral-500 hover:underline"
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <button
                    onClick={() => setAddingTo(category)}
                    className="text-xs text-neutral-500 hover:text-neutral-900 hover:underline"
                  >
                    + Add item
                  </button>
                )}
                {addingTo === category && addError && <p className="mt-2 text-xs text-red-600">{addError}</p>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
