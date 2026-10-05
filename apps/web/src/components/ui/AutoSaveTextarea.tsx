"use client";

import { useEffect, useRef, useState, type FocusEvent } from "react";
import { SaveStatus, type SaveStatusValue } from "@/components/ui/SaveStatus";
import { Textarea } from "@/components/ui/Textarea";

/**
 * A plain-looking textarea that saves itself on blur and makes the save
 * state visible ("Unsaved" / "Saving…" / "Saved" / error) — originally
 * built for Planning's editable fields, now shared wherever save-on-blur
 * feedback is needed (e.g. the Client detail page's Details & Notes tab)
 * so the operator never has to wonder whether an edit stuck. Uncontrolled
 * by design: pass a new `key` from the parent when the underlying value
 * legitimately changes from outside (e.g. a fresh analysis or refetch).
 */
export function AutoSaveTextarea({
  defaultValue,
  onSave,
  rows = 4,
  placeholder,
  disabled = false,
  className = "",
}: {
  defaultValue: string;
  onSave: (value: string) => Promise<unknown> | void;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [status, setStatus] = useState<SaveStatusValue>("idle");
  const revertTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (revertTimeout.current) clearTimeout(revertTimeout.current);
  }, []);

  // The value the last save attempt carried — what "Retry" sends again.
  const attempted = useRef(defaultValue);

  async function save(value: string) {
    attempted.current = value;
    if (revertTimeout.current) clearTimeout(revertTimeout.current);
    setStatus("saving");
    try {
      await onSave(value);
      setStatus("saved");
      revertTimeout.current = setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("error");
    }
  }

  function handleBlur(e: FocusEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    if (value === defaultValue) {
      setStatus("idle");
      return;
    }
    // Focus moving onto this field's own "Retry" button: let that click
    // send the one request, rather than this blur sending a second.
    const next = e.relatedTarget;
    if (next instanceof HTMLElement && next.hasAttribute("data-save-retry") && e.currentTarget.parentElement?.contains(next)) return;
    save(value);
  }

  return (
    <div>
      <Textarea
        defaultValue={defaultValue}
        onChange={() => {
          if (revertTimeout.current) clearTimeout(revertTimeout.current);
          setStatus("dirty");
        }}
        onBlur={handleBlur}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled || status === "saving"}
        className={`input ${className}`}
      />
      <SaveStatus
        status={status}
        dirtyText="Unsaved — click outside the field to save"
        className="mt-1"
        onRetry={() => save(attempted.current)}
      />
    </div>
  );
}
