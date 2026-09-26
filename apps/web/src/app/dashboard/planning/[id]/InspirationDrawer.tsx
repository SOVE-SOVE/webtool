"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api, ApiError, type Planning, type PlanningReference, type WebsiteReference } from "@/lib/api";
import { useDismissableOverlay } from "@/lib/useDismissableOverlay";
import { Badge } from "@/components/ui/Badge";
import { Checkbox } from "@/components/ui/Checkbox";
import { CloseIcon } from "@/components/ui/ControlIcons";
import { Input } from "@/components/ui/Input";
import { SearchInput } from "@/components/ui/SearchInput";
import { Skeleton } from "@/components/ui/Skeleton";
import { Textarea } from "@/components/ui/Textarea";
import { INSPIRATION_COPY_NOTE, ReferencePreview, referenceHost, useOverlaySafeConfirm } from "./InspirationStrip";

/** How often the library re-lists while any preview is still capturing. */
const CAPTURE_POLL_MS = 3000;
const TAG_LIMIT = 3;

/** "Bold, minimal ,  bold" → ["Bold", "minimal"] — trimmed, de-duplicated
 * case-insensitively, empties dropped. */
function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of raw.split(",")) {
    const tag = part.trim();
    if (tag && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase());
      tags.push(tag);
    }
  }
  return tags;
}

function tagsOf(list: WebsiteReference[]): string[] {
  return [...new Set(list.flatMap((r) => r.tags))].sort((a, b) => a.localeCompare(b));
}

/** A bare "example.com" gets https:// so it isn't rejected on a technicality;
 * anything else goes to the server as typed, which validates it. */
function normaliseUrl(raw: string): string {
  const url = raw.trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`;
}

/** Whether the plan's embedded copy of a reference is behind the library's. */
function isStale(embedded: WebsiteReference, fresh: WebsiteReference): boolean {
  return (
    embedded.capture_status !== fresh.capture_status ||
    embedded.screenshot_captured_at !== fresh.screenshot_captured_at ||
    embedded.name !== fresh.name ||
    embedded.notes !== fresh.notes ||
    embedded.archived_at !== fresh.archived_at ||
    embedded.tags.join("\u0000") !== fresh.tags.join("\u0000")
  );
}

/**
 * The shared Website Reference Library as a right-hand slide-over (the
 * app's `.side-panel` + `useDismissableOverlay` pattern, like NotesPanel):
 * search and tag filter, a small "Add reference" form, and compact cards
 * to attach to (or remove from) this plan. Mounted only while open.
 *
 * Previews are captured by a background job — new references arrive as
 * `pending`, and the list re-fetches every few seconds only while this is
 * open and something is still pending. Browsing never triggers a capture;
 * only "Retry" on a failed preview does.
 *
 * Attach/remove return the updated Planning (→ `onUpdated`). Library-only
 * edits (name/tags/notes, a finished capture) change the plan's embedded
 * copy too, so when an attached reference is seen to be out of date the
 * plan is re-read once to keep the strip truthful.
 */
export function InspirationDrawer({
  planning,
  onUpdated,
  onClose,
}: {
  planning: Planning;
  onUpdated: (p: Planning) => void;
  onClose: () => void;
}) {
  const { confirm, isConfirming } = useOverlaySafeConfirm();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { containerRef } = useDismissableOverlay({
    open: true,
    // Escape inside a confirm dialog must only close that dialog.
    onClose: () => {
      if (!isConfirming()) onClose();
    },
    initialFocusRef: closeButtonRef,
  });
  const titleId = useId();

  const attachments = planning.inspiration_references ?? [];
  const attachmentByRef = new Map<string, PlanningReference>(attachments.map((a) => [a.reference.id, a]));

  // --- Library list -----------------------------------------------------
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [items, setItems] = useState<WebsiteReference[] | null>(null);
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  // Latest planning for the stale-check below, without re-creating
  // `fetchList` (and re-listing) on every plan update.
  const planningRef = useRef(planning);
  useEffect(() => {
    planningRef.current = planning;
  });
  const syncingRef = useRef(false);

  const syncPlanningIfStale = useCallback(
    async (list: WebsiteReference[]) => {
      const current = planningRef.current;
      const fresh = new Map(list.map((r) => [r.id, r]));
      const stale = (current.inspiration_references ?? []).some((a) => {
        const f = fresh.get(a.reference.id);
        return f !== undefined && isStale(a.reference, f);
      });
      if (!stale || syncingRef.current) return;
      syncingRef.current = true;
      try {
        onUpdated(await api.getPlanningItem(current.id));
      } catch {
        // Non-critical — the strip catches up on the next plan load.
      } finally {
        syncingRef.current = false;
      }
    },
    [onUpdated],
  );

  const fetchList = useCallback(async () => {
    const seq = ++requestSeq.current;
    try {
      const list = await api.listWebsiteReferences({
        q: debouncedQuery || undefined,
        tag: tag ?? undefined,
        includeArchived: showArchived,
      });
      if (seq !== requestSeq.current) return;
      setItems(list);
      setLoadError(null);
      // Unfiltered results define the tag chips; filtered ones can only add.
      setKnownTags((prev) =>
        !debouncedQuery && !tag ? tagsOf(list) : [...new Set([...prev, ...tagsOf(list)])].sort((a, b) => a.localeCompare(b)),
      );
      syncPlanningIfStale(list);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setLoadError(err instanceof ApiError ? err.message : "Couldn't load the reference library.");
    }
  }, [debouncedQuery, tag, showArchived, syncPlanningIfStale]);

  useEffect(() => {
    // Fetch-on-change: every setState in fetchList runs after its await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchList();
  }, [fetchList]);

  // Poll only while something is still capturing; re-armed by each result.
  const hasPending = items?.some((r) => r.capture_status === "pending") ?? false;
  useEffect(() => {
    if (!hasPending) return;
    const t = setTimeout(fetchList, CAPTURE_POLL_MS);
    return () => clearTimeout(t);
  }, [hasPending, items, fetchList]);

  function replaceItem(updated: WebsiteReference) {
    setItems((prev) => prev?.map((r) => (r.id === updated.id ? updated : r)) ?? prev);
  }

  // --- Add form ---------------------------------------------------------
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [notes, setNotes] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [attachOnAdd, setAttachOnAdd] = useState(true);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const urlId = useId();
  const nameId = useId();
  const tagsId = useId();
  const notesId = useId();
  const addErrorId = useId();

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) {
      setAddError("Enter the site's address.");
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const created = await api.createWebsiteReference({
        url: normaliseUrl(url),
        name: name.trim() || null,
        tags: parseTags(tagsText),
        notes: notes.trim() || null,
      });
      setItems((prev) => [created, ...(prev ?? []).filter((r) => r.id !== created.id)]);
      setKnownTags((prev) => [...new Set([...prev, ...created.tags])].sort((a, b) => a.localeCompare(b)));
      setUrl("");
      setName("");
      setTagsText("");
      setNotes("");
      let message = `Added ${created.name} — capturing a preview in the background.`;
      if (attachOnAdd) {
        try {
          onUpdated(await api.attachPlanningReference(planning.id, created.id));
          message = `Added ${created.name} and attached it to this plan — capturing a preview in the background.`;
        } catch (err) {
          setAddError(
            `Added to the library, but couldn't attach it: ${err instanceof ApiError ? err.message : "try Attach on its card."}`,
          );
        }
      }
      setAnnounce(message);
    } catch (err) {
      // 400 (invalid/unsafe address) and 409 (already in the library)
      // carry a readable message — show it as-is.
      setAddError(err instanceof ApiError ? err.message : "Couldn't add that reference.");
    } finally {
      setAdding(false);
    }
  }

  // --- Card actions -----------------------------------------------------
  type BusyAction = "attach" | "detach" | "retry" | "archive" | "unarchive" | "delete" | "save";
  const [busy, setBusy] = useState<{ id: string; action: BusyAction } | null>(null);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);

  function setCardError(id: string, message: string | null) {
    setCardErrors((prev) => {
      const next = { ...prev };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });
  }

  async function run(id: string, kind: BusyAction, fallback: string, action: () => Promise<void>) {
    setBusy({ id, action: kind });
    setCardError(id, null);
    try {
      await action();
    } catch (err) {
      setCardError(id, err instanceof ApiError ? err.message : fallback);
    } finally {
      setBusy(null);
    }
  }

  const attach = (ref: WebsiteReference) =>
    run(ref.id, "attach", "Couldn't attach it.", async () => {
      onUpdated(await api.attachPlanningReference(planning.id, ref.id));
      replaceItem({ ...ref, usage_count: ref.usage_count + 1 });
    });

  async function detach(ref: WebsiteReference, attachment: PlanningReference) {
    if (attachment.liked_aspects.length > 0 || (attachment.direction && attachment.direction.trim())) {
      const ok = await confirm({
        title: `Remove “${ref.name}” from this plan?`,
        description:
          "This plan's notes about it will be lost. The reference itself stays in the shared library for other plans.",
        confirmLabel: "Remove from plan",
        danger: true,
      });
      if (!ok) return;
    }
    await run(ref.id, "detach", "Couldn't remove it from this plan.", async () => {
      onUpdated(await api.detachPlanningReference(planning.id, attachment.id));
      replaceItem({ ...ref, usage_count: Math.max(0, ref.usage_count - 1) });
    });
  }

  const retry = (ref: WebsiteReference) =>
    run(ref.id, "retry", "Couldn't retry the preview.", async () => {
      replaceItem(await api.retryWebsiteReferenceCapture(ref.id));
    });

  async function archive(ref: WebsiteReference) {
    await run(ref.id, "archive", "Couldn't archive it.", async () => {
      const updated = await api.archiveWebsiteReference(ref.id);
      if (showArchived) replaceItem(updated);
      else setItems((prev) => prev?.filter((r) => r.id !== ref.id) ?? prev);
      setEditingId(null);
      setAnnounce(`Archived ${ref.name}.`);
    });
  }

  async function unarchive(ref: WebsiteReference) {
    await run(ref.id, "unarchive", "Couldn't unarchive it.", async () => {
      replaceItem(await api.unarchiveWebsiteReference(ref.id));
      setAnnounce(`Restored ${ref.name}.`);
    });
  }

  async function remove(ref: WebsiteReference) {
    if (ref.usage_count > 0) {
      const ok = await confirm({
        title: `“${ref.name}” is used by ${ref.usage_count} plan${ref.usage_count === 1 ? "" : "s"}`,
        description:
          "It can't be deleted while plans use it. Archive it instead — it leaves the library list, and plans that use it keep it.",
        confirmLabel: ref.archived_at ? "OK" : "Archive instead",
      });
      if (ok && !ref.archived_at) await archive(ref);
      return;
    }
    const ok = await confirm({
      title: `Delete “${ref.name}”?`,
      description: "This removes it from the shared library and deletes its stored preview. This can't be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await run(ref.id, "delete", "Couldn't delete it.", async () => {
      await api.deleteWebsiteReference(ref.id);
      setItems((prev) => prev?.filter((r) => r.id !== ref.id) ?? prev);
      setEditingId(null);
      setAnnounce(`Deleted ${ref.name}.`);
    });
  }

  async function saveEdit(ref: WebsiteReference, data: { name: string; tags: string[]; notes: string | null }) {
    let ok = false;
    await run(ref.id, "save", "Couldn't save these changes.", async () => {
      const updated = await api.updateWebsiteReference(ref.id, data);
      replaceItem(updated);
      setKnownTags((prev) => [...new Set([...prev, ...updated.tags])].sort((a, b) => a.localeCompare(b)));
      syncPlanningIfStale([updated]);
      ok = true;
    });
    if (ok) setEditingId(null);
  }

  const filtering = debouncedQuery !== "" || tag !== null;
  const attachedCount = attachments.length;

  return (
    <div className="side-panel-overlay" onClick={() => !isConfirming() && onClose()} role="presentation">
      <div
        ref={containerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="side-panel side-panel--wide focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-fg">
              Inspiration
            </h2>
            <p className="mt-1 text-xs text-fg-muted">
              Pick two or three sites whose look you like.
              {attachedCount > 0 && ` ${attachedCount} attached to this plan.`}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close inspiration library"
            className="shrink-0 rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <CloseIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {/* Add reference */}
          <form onSubmit={handleAdd} noValidate className="space-y-2 rounded-md border border-border bg-surface-subtle p-3">
            <label htmlFor={urlId} className="field-label text-xs">
              Add a reference
            </label>
            <div className="flex gap-2">
              <Input
                id={urlId}
                type="url"
                inputMode="url"
                autoComplete="off"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (addError) setAddError(null);
                }}
                placeholder="https://example.com"
                aria-invalid={addError ? true : undefined}
                aria-describedby={addError ? addErrorId : undefined}
                className="input min-w-0 flex-1"
              />
              <button type="submit" disabled={adding} className="btn btn-primary shrink-0">
                {adding ? "Adding…" : "Add"}
              </button>
            </div>
            <button
              type="button"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
              className="rounded text-xs font-medium text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              {moreOpen ? "Hide name, tags and notes" : "Add a name, tags or notes"}
            </button>
            {moreOpen && (
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label htmlFor={nameId} className="text-xs font-medium text-fg-muted">
                    Name <span className="font-normal text-fg-subtle">(optional)</span>
                  </label>
                  <Input
                    id={nameId}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Taken from the address if blank"
                    className="input mt-1"
                  />
                </div>
                <div>
                  <label htmlFor={tagsId} className="text-xs font-medium text-fg-muted">
                    Tags <span className="font-normal text-fg-subtle">(comma-separated)</span>
                  </label>
                  <Input
                    id={tagsId}
                    value={tagsText}
                    onChange={(e) => setTagsText(e.target.value)}
                    placeholder="minimal, trades"
                    className="input mt-1"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor={notesId} className="text-xs font-medium text-fg-muted">
                    Notes <span className="font-normal text-fg-subtle">(shared with every plan)</span>
                  </label>
                  <Textarea
                    id={notesId}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    className="input mt-1"
                  />
                </div>
              </div>
            )}
            <label className="flex items-center gap-2 text-xs text-fg-muted">
              <Checkbox checked={attachOnAdd} onChange={(e) => setAttachOnAdd(e.target.checked)} />
              Also attach it to this plan
            </label>
            {addError && (
              <p id={addErrorId} className="text-error" role="alert">
                {addError}
              </p>
            )}
          </form>

          {/* Search + tags */}
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <SearchInput
                value={query}
                onValueChange={setQuery}
                placeholder="Search references"
                aria-label="Search references"
                className="h-8 flex-1 px-2 text-xs [&_input]:text-xs"
              />
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-fg-muted">
                <Checkbox checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
                Show archived
              </label>
            </div>
            {knownTags.length > 0 && (
              <div role="group" aria-label="Filter by tag" className="flex flex-wrap gap-1">
                {knownTags.map((t) => {
                  const on = tag === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setTag(on ? null : t)}
                      className={`toggle-pill rounded-full border px-2.5 py-1 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
                        on ? "border-fg bg-surface text-fg" : "border-border bg-surface-subtle text-fg-muted hover:text-fg"
                      }`}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Library */}
          {loadError && items === null ? (
            <div className="rounded-md border border-border p-4 text-center">
              <p className="text-error">{loadError}</p>
              <button type="button" onClick={fetchList} className="btn btn-secondary btn-sm mt-2">
                Try again
              </button>
            </div>
          ) : items === null ? (
            <ul aria-label="Loading references" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <li key={i} className="card overflow-hidden">
                  <Skeleton className="aspect-[16/10] w-full rounded-none" />
                  <div className="space-y-2 p-2.5">
                    <Skeleton className="h-3 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </li>
              ))}
            </ul>
          ) : items.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center">
              {filtering ? (
                <p className="text-sm text-fg-muted">No references match — try another search or tag.</p>
              ) : (
                <>
                  <p className="text-sm font-medium text-fg">No references yet</p>
                  <p className="mt-1 text-xs text-fg-muted">
                    Add a site whose look you like — its preview is captured once and kept for every plan.
                  </p>
                </>
              )}
            </div>
          ) : (
            <>
              {loadError && <p className="text-error">{loadError}</p>}
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {items.map((ref) => (
                  <ReferenceCard
                    key={ref.id}
                    reference={ref}
                    attachment={attachmentByRef.get(ref.id) ?? null}
                    busy={busy?.id === ref.id ? busy.action : null}
                    anyBusy={busy !== null}
                    error={cardErrors[ref.id] ?? null}
                    editing={editingId === ref.id}
                    onEdit={() => setEditingId(editingId === ref.id ? null : ref.id)}
                    onAttach={() => attach(ref)}
                    onDetach={(a) => detach(ref, a)}
                    onRetry={() => retry(ref)}
                    onSave={(data) => saveEdit(ref, data)}
                    onArchive={() => archive(ref)}
                    onUnarchive={() => unarchive(ref)}
                    onDelete={() => remove(ref)}
                  />
                ))}
              </ul>
            </>
          )}

          <p className="text-[11px] text-fg-subtle">{INSPIRATION_COPY_NOTE}</p>
          <p className="sr-only" role="status">
            {announce}
          </p>
        </div>
      </div>
    </div>
  );
}

/** One compact library card — preview (or its honest capture state), name,
 * up to three tags, the Attach/Remove toggle for this plan, an Open-site
 * link, and an Edit toggle that expands the card (full row width) into a
 * small editor for the shared name/tags/notes plus Archive and Delete. */
function ReferenceCard({
  reference,
  attachment,
  busy,
  anyBusy,
  error,
  editing,
  onEdit,
  onAttach,
  onDetach,
  onRetry,
  onSave,
  onArchive,
  onUnarchive,
  onDelete,
}: {
  reference: WebsiteReference;
  attachment: PlanningReference | null;
  /** The action running on this card, if any — names the busy label. */
  busy: string | null;
  anyBusy: boolean;
  error: string | null;
  editing: boolean;
  onEdit: () => void;
  onAttach: () => void;
  onDetach: (attachment: PlanningReference) => void;
  onRetry: () => void;
  onSave: (data: { name: string; tags: string[]; notes: string | null }) => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
}) {
  const editorId = useId();
  const archived = reference.archived_at !== null;
  const extraTags = reference.tags.length - TAG_LIMIT;

  return (
    <li className={`card flex min-w-0 flex-col overflow-hidden ${editing ? "sm:col-span-2" : ""} ${archived ? "opacity-80" : ""}`}>
      <div className="relative">
        <ReferencePreview reference={reference} className="border-b border-border" />
        {reference.capture_status === "failed" && (
          <button
            type="button"
            onClick={onRetry}
            disabled={anyBusy}
            className="btn btn-secondary btn-sm absolute bottom-2 right-2"
            aria-label={`Retry the preview for ${reference.name}`}
          >
            {busy === "retry" ? "Retrying…" : "Retry"}
          </button>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-fg" title={reference.name}>
            {reference.name}
          </p>
          <p className="truncate text-[11px] text-fg-subtle" title={reference.url}>
            {referenceHost(reference.url)}
          </p>
        </div>
        {reference.capture_status === "failed" && reference.capture_error && (
          <p className="line-clamp-2 text-[11px] text-fg-subtle" title={reference.capture_error}>
            {reference.capture_error}
          </p>
        )}
        {(reference.tags.length > 0 || archived) && (
          <div className="flex flex-wrap items-center gap-1">
            {archived && <Badge tone="warning">Archived</Badge>}
            {reference.tags.slice(0, TAG_LIMIT).map((t) => (
              <Badge key={t} className="max-w-full truncate">
                {t}
              </Badge>
            ))}
            {extraTags > 0 && (
              <span className="text-[11px] text-fg-subtle" title={reference.tags.slice(TAG_LIMIT).join(", ")}>
                +{extraTags}
              </span>
            )}
          </div>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
          {attachment ? (
            <>
              <span className="inline-flex items-center gap-1 text-xs font-medium text-fg">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
                  <path d="m5 13 4 4 10-10" />
                </svg>
                Attached
              </span>
              <button
                type="button"
                onClick={() => onDetach(attachment)}
                disabled={anyBusy}
                aria-label={`Remove ${reference.name} from this plan`}
                className="btn btn-ghost btn-sm"
              >
                {busy === "detach" ? "Removing…" : "Remove"}
              </button>
            </>
          ) : archived ? (
            <button type="button" onClick={onUnarchive} disabled={anyBusy} className="btn btn-secondary btn-sm">
              {busy === "unarchive" ? "Restoring…" : "Unarchive"}
            </button>
          ) : (
            <button
              type="button"
              onClick={onAttach}
              disabled={anyBusy}
              aria-label={`Attach ${reference.name} to this plan`}
              className="btn btn-secondary btn-sm"
            >
              {busy === "attach" ? "Attaching…" : "Attach"}
            </button>
          )}
          <span className="ml-auto flex items-center gap-0.5">
            <a
              href={reference.url}
              target="_blank"
              rel="noreferrer"
              className="rounded px-1.5 py-1 text-xs font-medium text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              Open ↗<span className="sr-only"> {reference.name} (opens in a new tab)</span>
            </a>
            <button
              type="button"
              onClick={onEdit}
              aria-expanded={editing}
              aria-controls={editing ? editorId : undefined}
              aria-label={`Edit ${reference.name}`}
              className="flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
                <circle cx="4.5" cy="10" r="1.5" />
                <circle cx="10" cy="10" r="1.5" />
                <circle cx="15.5" cy="10" r="1.5" />
              </svg>
            </button>
          </span>
        </div>

        {error && <p className="text-error text-xs">{error}</p>}

        {editing && (
          <ReferenceEditor
            id={editorId}
            reference={reference}
            busy={busy}
            disabled={anyBusy}
            onSave={onSave}
            onCancel={onEdit}
            onArchive={onArchive}
            onUnarchive={onUnarchive}
            onDelete={onDelete}
          />
        )}
      </div>
    </li>
  );
}

function ReferenceEditor({
  id,
  reference,
  busy,
  disabled,
  onSave,
  onCancel,
  onArchive,
  onUnarchive,
  onDelete,
}: {
  id: string;
  reference: WebsiteReference;
  busy: string | null;
  disabled: boolean;
  onSave: (data: { name: string; tags: string[]; notes: string | null }) => void;
  onCancel: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(reference.name);
  const [tagsText, setTagsText] = useState(reference.tags.join(", "));
  const [notes, setNotes] = useState(reference.notes ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const nameId = useId();
  const tagsId = useId();
  const notesId = useId();
  const archived = reference.archived_at !== null;

  return (
    <form
      id={id}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) {
          setNameError("A name is required.");
          return;
        }
        setNameError(null);
        onSave({ name: name.trim(), tags: parseTags(tagsText), notes: notes.trim() || null });
      }}
      className="mt-1 space-y-2 border-t border-border pt-2.5"
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label htmlFor={nameId} className="text-xs font-medium text-fg-muted">
            Name
          </label>
          <Input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={nameError ? true : undefined}
            className="input mt-1"
          />
          {nameError && <p className="mt-1 text-error text-xs">{nameError}</p>}
        </div>
        <div>
          <label htmlFor={tagsId} className="text-xs font-medium text-fg-muted">
            Tags <span className="font-normal text-fg-subtle">(comma-separated)</span>
          </label>
          <Input id={tagsId} value={tagsText} onChange={(e) => setTagsText(e.target.value)} className="input mt-1" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={notesId} className="text-xs font-medium text-fg-muted">
            Notes <span className="font-normal text-fg-subtle">(shared with every plan that uses it)</span>
          </label>
          <Textarea id={notesId} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input mt-1" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="submit" disabled={disabled} className="btn btn-primary btn-sm">
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onCancel} className="btn btn-secondary btn-sm">
          Cancel
        </button>
        <span className="ml-auto flex items-center gap-1.5">
          {archived ? (
            <button type="button" onClick={onUnarchive} disabled={disabled} className="btn btn-ghost btn-sm">
              {busy === "unarchive" ? "Restoring…" : "Unarchive"}
            </button>
          ) : (
            <button type="button" onClick={onArchive} disabled={disabled} className="btn btn-ghost btn-sm">
              {busy === "archive" ? "Archiving…" : "Archive"}
            </button>
          )}
          <button type="button" onClick={onDelete} disabled={disabled} className="btn btn-ghost btn-sm text-danger">
            {busy === "delete" ? "Deleting…" : "Delete"}
          </button>
        </span>
      </div>
    </form>
  );
}
