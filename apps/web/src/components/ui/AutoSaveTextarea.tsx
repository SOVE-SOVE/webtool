"use client";

import { useEffect, useRef, useState, type FocusEvent } from "react";
import { SaveStatus, type SaveStatusValue } from "@/components/ui/SaveStatus";

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

  async function handleBlur(e: FocusEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    if (value === defaultValue) {
      setStatus("idle");
      return;
    }
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

  return (
    <div>
      <textarea
        defaultValue={defaultValue}
        onChange={() => {
          if (revertTimeout.current) clearTimeout(revertTimeout.current);
          setStatus("dirty");
        }}
        onBlur={handleBlur}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled || status === "saving"}
        className={`w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm ${className}`}
      />
      <SaveStatus status={status} dirtyText="Unsaved — click outside the field to save" className="mt-1" />
    </div>
  );
}
