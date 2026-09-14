"use client";

import { useState } from "react";
import { api, ApiError, type Planning, type SitemapPageProposal } from "@/lib/api";
import { Input } from "@/components/ui/Input";

function PageRow({
  planningId,
  page,
  position,
  orderedPages,
  onUpdated,
}: {
  planningId: string;
  page: SitemapPageProposal;
  position: number;
  orderedPages: SitemapPageProposal[];
  onUpdated: (p: Planning) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(page.title);
  const [purpose, setPurpose] = useState(page.purpose);
  const total = orderedPages.length;

  async function move(delta: number) {
    const neighbor = orderedPages[position + delta];
    if (!neighbor) return;
    onUpdated(
      await api.reorderPlanningSitemapPages(planningId, {
        pages: [
          { id: page.id, order_index: neighbor.order_index },
          { id: neighbor.id, order_index: page.order_index },
        ],
      }),
    );
  }

  async function handleDelete() {
    onUpdated(await api.deletePlanningSitemapPage(planningId, page.id));
  }

  return (
    <li className="rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-1.5">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-md border border-border-strong bg-surface px-2 py-1 text-sm font-medium"
              />
              <Input
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                className="w-full rounded-md border border-border-strong bg-surface px-2 py-1 text-xs"
              />
              <button
                type="button"
                onClick={async () => {
                  onUpdated(await api.updatePlanningSitemapPage(planningId, page.id, { title, purpose }));
                  setEditing(false);
                }}
                className="btn btn-secondary btn-sm"
              >
                Save
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-sm font-medium text-fg">{page.title}</p>
                <span className="rounded bg-surface-subtle px-1.5 py-0.5 text-xs text-fg-muted">{page.page_type}</span>
                {page.needs_confirmation && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                    Needs confirmation
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-fg-muted">{page.purpose}</p>
              <p className="mt-1 text-xs text-fg-subtle">{page.reason}</p>
              {page.key_sections.length > 0 && (
                <p className="mt-1 text-xs text-fg-subtle">Sections: {page.key_sections.join(", ")}</p>
              )}
            </>
          )}
        </div>
        {!editing && (
          <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
            <div className="flex gap-1">
              <button type="button" onClick={() => move(-1)} disabled={position === 0} className="text-fg-muted hover:text-fg disabled:opacity-30">
                ↑
              </button>
              <button type="button" onClick={() => move(1)} disabled={position === total - 1} className="text-fg-muted hover:text-fg disabled:opacity-30">
                ↓
              </button>
            </div>
            <button type="button" onClick={() => setEditing(true)} className="font-medium text-fg-muted hover:underline">
              Edit
            </button>
            <button type="button" onClick={handleDelete} className="font-medium text-fg-subtle hover:underline">
              Remove
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

/** Build Brief's "Proposed Sitemap and Homepage Outline" — Planning's
 * own pre-Project proposal; becomes a real Sitemap/SitemapPage at
 * Create Project (see LeadPlanningSitemapPage's docstring). */
export function SitemapProposalSection({ planning, onUpdated }: { planning: Planning; onUpdated: (p: Planning) => void }) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPurpose, setNewPurpose] = useState("");

  const pages = [...planning.sitemap_pages].sort((a, b) => a.order_index - b.order_index);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      onUpdated(await api.generateSitemapProposal(planning.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't generate a sitemap proposal.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleAdd() {
    if (!newTitle.trim()) return;
    onUpdated(await api.addPlanningSitemapPage(planning.id, { title: newTitle, purpose: newPurpose || "" }));
    setAdding(false);
    setNewTitle("");
    setNewPurpose("");
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-fg-muted">{pages.length} page{pages.length === 1 ? "" : "s"} proposed</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => setAdding((v) => !v)} className="btn btn-secondary btn-sm">
            + Add page
          </button>
          <button type="button" onClick={handleGenerate} disabled={generating} className="btn btn-primary btn-sm">
            {generating ? "Generating…" : pages.length > 0 ? "Regenerate" : "Generate"}
          </button>
        </div>
      </div>
      {error && <p className="text-error">{error}</p>}
      {adding && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <Input
            placeholder="Page title"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            className="w-full rounded-md border border-border-strong bg-surface px-2 py-1 text-sm"
          />
          <Input
            placeholder="Purpose"
            value={newPurpose}
            onChange={(e) => setNewPurpose(e.target.value)}
            className="w-full rounded-md border border-border-strong bg-surface px-2 py-1 text-sm"
          />
          <button type="button" onClick={handleAdd} className="btn btn-secondary btn-sm">
            Add
          </button>
        </div>
      )}
      {pages.length > 0 ? (
        <ul className="space-y-2">
          {pages.map((page, i) => (
            <PageRow key={page.id} planningId={planning.id} page={page} position={i} orderedPages={pages} onUpdated={onUpdated} />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-fg-subtle">Nothing here yet.</p>
      )}
    </div>
  );
}
