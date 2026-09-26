"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  api,
  ApiError,
  LIKED_ASPECT_LABELS,
  LIKED_ASPECTS,
  type LikedAspect,
  type Planning,
  type PlanningReference,
  type WebsiteReference,
} from "@/lib/api";
import { useConfirm } from "@/components/ui/ConfirmProvider";
import { SaveStatus, type SaveStatusValue } from "@/components/ui/SaveStatus";
import { Textarea } from "@/components/ui/Textarea";
import { CloseIcon } from "@/components/ui/ControlIcons";
import { useDismissableOverlay } from "@/lib/useDismissableOverlay";

/** The copy line every inspiration surface carries — references show how a
 * site should look and feel, never material to reuse. */
export const INSPIRATION_COPY_NOTE = "References are inspiration — don't copy their text, branding, imagery or code.";

/** "www.example.com/path" → "example.com" — for a compact, readable label. */
export function referenceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** A plan's attachments in their saved order. */
export function sortedAttachments(planning: Planning): PlanningReference[] {
  return [...(planning.inspiration_references ?? [])].sort((a, b) => a.order_index - b.order_index);
}

/**
 * `useConfirm()` wrapped for use inside a `useDismissableOverlay` surface.
 * Both listen for Escape on `document`, so Escape in the confirm dialog
 * would also reach the overlay's `onClose`. `isConfirming()` stays true
 * until the task after the confirm settles (not just the microtask), so
 * the overlay can ignore that same keypress.
 */
export function useOverlaySafeConfirm() {
  const confirm = useConfirm();
  const confirmingRef = useRef(false);
  async function guardedConfirm(options: Parameters<typeof confirm>[0]): Promise<boolean> {
    confirmingRef.current = true;
    try {
      return await confirm(options);
    } finally {
      setTimeout(() => {
        confirmingRef.current = false;
      }, 0);
    }
  }
  return { confirm: guardedConfirm, isConfirming: () => confirmingRef.current };
}

/**
 * A reference's stored preview, or an honest stand-in — never a fake image.
 * Only ever reads the stored screenshot (`websiteReferenceScreenshotUrl`);
 * nothing here triggers a capture.
 */
export function ReferencePreview({
  reference,
  className = "",
  compact = false,
}: {
  reference: WebsiteReference;
  className?: string;
  /** Tiny thumbnails (the strip) — shorter state labels. */
  compact?: boolean;
}) {
  // Keyed by URL, so a retried capture (new `v`) gets a fresh attempt.
  const src = api.websiteReferenceScreenshotUrl(reference);
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const shell = `relative flex aspect-[16/10] w-full items-center justify-center overflow-hidden bg-surface-subtle ${className}`;

  if (reference.capture_status === "captured" && reference.has_screenshot && brokenSrc !== src) {
    return (
      <div className={shell}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a stored preview from an authenticated API route, not an optimizable static asset */}
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setBrokenSrc(src)}
          className="h-full w-full object-cover object-top"
        />
      </div>
    );
  }
  if (reference.capture_status === "pending") {
    return (
      <div className={`${shell} skeleton`}>
        <span className="px-2 text-center text-[11px] text-fg-muted">{compact ? "Capturing…" : "Capturing preview…"}</span>
      </div>
    );
  }
  return (
    <div className={shell} title={reference.capture_error ?? undefined}>
      <span className="px-2 text-center text-[11px] text-fg-subtle">{compact ? "No preview" : "Preview unavailable"}</span>
    </div>
  );
}

/**
 * The plan's attached inspiration sites as a compact row of thumbnails —
 * deliberately separate from the canvas's feature chips (not draggable, not
 * a requirement). RequirementsBoard renders it inside its own bounded
 * layout, below the canvas frame, so the canvas still fits the viewport.
 * Renders nothing when nothing is attached.
 *
 * Clicking a thumbnail opens `InspirationDetailPanel` for that plan's own
 * attachment (liked aspects + direction). Its unsaved-edit state is
 * reported through `onDirtyChange`, so leaving the step warns.
 */
export function InspirationStrip({
  planning,
  onUpdated,
  onDirtyChange,
  onOpenLibrary,
}: {
  planning: Planning;
  onUpdated: (p: Planning) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onOpenLibrary?: () => void;
}) {
  const attachments = sortedAttachments(planning);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const open = openId ? attachments.find((a) => a.id === openId) ?? null : null;
  const labelId = useId();

  useEffect(() => {
    onDirtyChange?.(open !== null && dirty);
  }, [open, dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  if (attachments.length === 0) return null;

  return (
    <section aria-labelledby={labelId} className="mt-2 flex shrink-0 items-start gap-3">
      <div className="w-20 shrink-0 pt-1">
        <h3 id={labelId} className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Inspiration
        </h3>
        <p className="mt-0.5 text-[11px] text-fg-subtle">Look and feel only</p>
      </div>
      <ul className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
        {attachments.map((a) => {
          const noted = a.liked_aspects.length > 0 || Boolean(a.direction && a.direction.trim());
          return (
            <li key={a.id} className="w-[104px] shrink-0">
              <button
                type="button"
                onClick={() => setOpenId(a.id)}
                aria-haspopup="dialog"
                aria-label={`${a.reference.name} — edit what you like about it for this plan`}
                title={a.reference.name}
                className="group block w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                <ReferencePreview
                  reference={a.reference}
                  compact
                  className="rounded-md border border-border transition-colors duration-fast ease-standard group-hover:border-border-strong motion-reduce:transition-none"
                />
                <span className="mt-1 flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-fg">{a.reference.name}</span>
                  {noted && (
                    <span aria-hidden="true" title="Has notes for this plan" className="h-1.5 w-1.5 shrink-0 rounded-full bg-fg-muted" />
                  )}
                </span>
              </button>
            </li>
          );
        })}
        {onOpenLibrary && (
          <li className="w-[104px] shrink-0">
            <button
              type="button"
              onClick={onOpenLibrary}
              aria-haspopup="dialog"
              className="flex aspect-[16/10] w-full items-center justify-center rounded-md border border-dashed border-border-strong text-[11px] font-medium text-fg-muted transition-colors duration-fast ease-standard hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring motion-reduce:transition-none"
            >
              + Add
            </button>
          </li>
        )}
      </ul>

      {open && (
        <InspirationDetailPanel
          key={open.id}
          planningId={planning.id}
          attachment={open}
          onUpdated={onUpdated}
          onDirtyChange={setDirty}
          onClose={() => {
            setOpenId(null);
            setDirty(false);
          }}
        />
      )}
    </section>
  );
}

function sameAspects(a: LikedAspect[], b: LikedAspect[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/**
 * One plan's attachment of a shared reference — what this plan takes from
 * it. A right-hand slide-over (the app's `.side-panel` pattern) with
 * explicit Save/Cancel, so "dirty" is a plain comparison against the saved
 * values, same as the requirement notes editor. The shared library notes
 * are shown read-only and visually apart from the plan's own direction.
 */
function InspirationDetailPanel({
  planningId,
  attachment,
  onUpdated,
  onDirtyChange,
  onClose,
}: {
  planningId: string;
  attachment: PlanningReference;
  onUpdated: (p: Planning) => void;
  onDirtyChange: (dirty: boolean) => void;
  onClose: () => void;
}) {
  const { confirm, isConfirming } = useOverlaySafeConfirm();
  const reference = attachment.reference;
  const savedDirection = attachment.direction ?? "";
  const savedAspects = attachment.liked_aspects;
  const [direction, setDirection] = useState(savedDirection);
  const [aspects, setAspects] = useState<LikedAspect[]>(savedAspects);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorText, setErrorText] = useState<string | undefined>();
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const dirty = direction.trim() !== savedDirection.trim() || !sameAspects(aspects, savedAspects);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  async function requestClose() {
    if (isConfirming()) return;
    if (dirty) {
      const ok = await confirm({
        title: "Discard unsaved changes?",
        description: "What you noted about this reference hasn't been saved yet. Closing will discard it.",
        confirmLabel: "Discard changes",
        danger: true,
      });
      if (!ok) return;
    }
    onClose();
  }

  // useDismissableOverlay keeps the `onClose` it was first given, so Escape
  // goes through a ref to always reach the latest (dirty-aware) close.
  const requestCloseRef = useRef(requestClose);
  useEffect(() => {
    requestCloseRef.current = requestClose;
  });
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { containerRef } = useDismissableOverlay({
    open: true,
    onClose: () => requestCloseRef.current(),
    initialFocusRef: closeButtonRef,
  });
  const titleId = useId();
  const directionId = useId();
  const aspectsLabelId = useId();

  function toggleAspect(aspect: LikedAspect) {
    setAspects((prev) => (prev.includes(aspect) ? prev.filter((a) => a !== aspect) : [...prev, aspect]));
    if (status !== "saving") setStatus("idle");
  }

  async function save() {
    setStatus("saving");
    setErrorText(undefined);
    try {
      // Catalogue order, whatever order the chips were toggled in.
      const ordered = LIKED_ASPECTS.filter((a) => aspects.includes(a));
      const updated = await api.updatePlanningReference(planningId, attachment.id, {
        direction: direction.trim() || null,
        liked_aspects: ordered,
      });
      onUpdated(updated);
      setAspects(ordered);
      setStatus("saved");
    } catch (err) {
      setErrorText(err instanceof ApiError ? err.message : "Couldn't save — try again.");
      setStatus("error");
    }
  }

  function cancel() {
    setDirection(savedDirection);
    setAspects(savedAspects);
    setStatus("idle");
    setErrorText(undefined);
  }

  async function removeFromPlan() {
    if (isConfirming()) return;
    const hasOwnNotes = savedAspects.length > 0 || savedDirection.trim() !== "" || dirty;
    if (hasOwnNotes) {
      const ok = await confirm({
        title: `Remove “${reference.name}” from this plan?`,
        description:
          "This plan's notes about it will be lost. The reference itself stays in the shared library for other plans.",
        confirmLabel: "Remove from plan",
        danger: true,
      });
      if (!ok) return;
    }
    setRemoving(true);
    setRemoveError(null);
    try {
      const updated = await api.detachPlanningReference(planningId, attachment.id);
      onDirtyChange(false);
      onUpdated(updated);
      onClose();
    } catch (err) {
      setRemoveError(err instanceof ApiError ? err.message : "Couldn't remove it from this plan.");
      setRemoving(false);
    }
  }

  const displayStatus: SaveStatusValue =
    status === "saving" ? "saving" : status === "error" ? "error" : dirty ? "dirty" : status === "saved" ? "saved" : "idle";

  return (
    <div className="side-panel-overlay" onClick={requestClose} role="presentation">
      <div
        ref={containerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="side-panel focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-fg-muted">Inspiration for this plan</p>
            <h2 id={titleId} className="truncate text-base font-semibold text-fg" title={reference.name}>
              {reference.name}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={requestClose}
            aria-label="Close"
            className="shrink-0 rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <CloseIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
          <div>
            <ReferencePreview reference={reference} className="rounded-md border border-border" />
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-xs text-fg-muted" title={reference.url}>
                {referenceHost(reference.url)}
              </p>
              <a
                href={reference.url}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 rounded text-xs font-medium text-fg underline decoration-border-strong underline-offset-2 hover:decoration-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                Open site ↗<span className="sr-only"> (opens in a new tab)</span>
              </a>
            </div>
            {reference.capture_status === "failed" && reference.capture_error && (
              <p className="mt-1 text-[11px] text-fg-subtle">Preview unavailable: {reference.capture_error}</p>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <p id={aspectsLabelId} className="field-label text-xs">
                What you like about it
              </p>
              <div role="group" aria-labelledby={aspectsLabelId} className="mt-1.5 flex flex-wrap gap-1.5">
                {LIKED_ASPECTS.map((aspect) => {
                  const on = aspects.includes(aspect);
                  return (
                    <button
                      key={aspect}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleAspect(aspect)}
                      className={`toggle-pill inline-flex min-h-8 items-center gap-1 rounded-full border px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
                        on ? "border-fg bg-surface text-fg" : "border-border bg-surface-subtle text-fg-muted hover:text-fg"
                      }`}
                    >
                      {on && (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden="true">
                          <path d="m5 13 4 4 10-10" />
                        </svg>
                      )}
                      {LIKED_ASPECT_LABELS[aspect]}
                    </button>
                  );
                })}
              </div>
              {aspects.includes("interaction") && (
                <p className="mt-1.5 text-[11px] text-fg-subtle">
                  A screenshot can&apos;t show motion — check the live site; this is your own note.
                </p>
              )}
            </div>

            <div>
              <label htmlFor={directionId} className="field-label text-xs">
                Direction for this plan
              </label>
              <Textarea
                id={directionId}
                value={direction}
                onChange={(e) => {
                  setDirection(e.target.value);
                  if (status !== "saving") setStatus("idle");
                }}
                rows={3}
                className="input mt-1"
                placeholder="Use the spacious layout, but not the colours."
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={save} disabled={!dirty || status === "saving"} className="btn btn-primary btn-sm">
                {status === "saving" ? "Saving…" : "Save"}
              </button>
              <button type="button" onClick={cancel} disabled={!dirty || status === "saving"} className="btn btn-secondary btn-sm">
                Cancel
              </button>
              <SaveStatus status={displayStatus} errorText={errorText} className="w-auto" />
            </div>
          </div>

          <section aria-label="Shared library notes" className="rounded-md border border-border bg-surface-subtle p-3">
            <p className="text-xs font-medium text-fg-muted">Library notes · shared with every plan</p>
            {reference.notes && reference.notes.trim() ? (
              <p className="mt-1 whitespace-pre-line text-xs text-fg">{reference.notes}</p>
            ) : (
              <p className="mt-1 text-xs text-fg-subtle">No shared notes. Edit them from the Inspiration library.</p>
            )}
          </section>

          <p className="text-xs text-fg-muted">{INSPIRATION_COPY_NOTE}</p>
        </div>

        <div className="shrink-0 border-t border-border p-4">
          <button type="button" onClick={removeFromPlan} disabled={removing} className="btn btn-secondary btn-sm">
            {removing ? "Removing…" : "Remove from this plan"}
          </button>
          <p className="mt-1.5 text-[11px] text-fg-subtle">Keeps the reference in the shared library for other plans.</p>
          {removeError && <p className="mt-1 text-error">{removeError}</p>}
        </div>
      </div>
    </div>
  );
}
