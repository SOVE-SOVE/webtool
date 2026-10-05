"use client";

import { useEffect, useRef, useState } from "react";
import { COPY_FEEDBACK_MS, copyAnnouncement, copyOutcome, writeClipboard, type CopyStatus } from "@/lib/copyFeedback";
import { CompletionCheck } from "./CompletionCheck";
import { Tooltip } from "./Tooltip";

/**
 * An icon-only "copy this" control for a URL or email shown on a detail
 * page. Sits *beside* the link it copies (a sibling, never inside the
 * anchor), so the link keeps opening as before; its own click never
 * reaches a surrounding row or card.
 *
 * `value` is the full underlying value (the real href or address), not
 * whatever shortened text is on screen. `label` is the specific
 * accessible name ("Copy website address"); `tooltip` the short visible
 * one ("Copy link").
 *
 * The tick only appears once the clipboard write has really resolved; a
 * failure (denied, unavailable, insecure context) says "Couldn't copy"
 * and the value beside it stays selectable. Either state reverts after
 * COPY_FEEDBACK_MS and is announced once through a polite live region.
 */
export function CopyButton({
  value,
  label,
  tooltip = "Copy link",
  className = "",
}: {
  value: string;
  label: string;
  tooltip?: string;
  className?: string;
}) {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const attempt = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      // Unmounted mid-write or mid-feedback: drop the timer, and make any
      // write still in flight a superseded one.
      attempt.current += 1;
      window.clearTimeout(timer.current);
    },
    [],
  );

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const mine = (attempt.current += 1);
    // Called here, synchronously, so the write is inside the user gesture.
    void writeClipboard(value).then((ok) => {
      const next = copyOutcome(ok, mine, attempt.current);
      if (!next) return;
      setStatus(next);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setStatus("idle"), COPY_FEEDBACK_MS);
    });
  }

  return (
    <>
      <Tooltip label={copyAnnouncement(status) || tooltip} open={status !== "idle"}>
        <button
          type="button"
          onClick={handleClick}
          aria-label={label}
          className={`relative inline-flex size-6 shrink-0 items-center justify-center rounded align-middle text-fg-subtle transition-colors duration-fast ease-standard after:absolute after:-inset-2 hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring motion-reduce:transition-none ${className}`}
        >
          {status === "copied" ? (
            <CompletionCheck animate className="!size-3.5 text-[var(--pill-success-fg)]" />
          ) : status === "failed" ? (
            <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5 fill-none stroke-current text-[var(--pill-danger-fg)]" strokeWidth="1.5" strokeLinecap="round">
              <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5 fill-none stroke-current" strokeWidth="1.25" strokeLinejoin="round">
              <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
              <path d="M10.5 3.5v-.25A1.25 1.25 0 0 0 9.25 2h-6A1.25 1.25 0 0 0 2 3.25v6A1.25 1.25 0 0 0 3.25 10.5h.25" strokeLinecap="round" />
            </svg>
          )}
        </button>
      </Tooltip>
      <span role="status" className="sr-only">
        {copyAnnouncement(status)}
      </span>
    </>
  );
}
