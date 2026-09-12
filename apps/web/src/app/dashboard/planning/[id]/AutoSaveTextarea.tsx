"use client";

import { useState, type FocusEvent } from "react";

/**
 * A plain-looking textarea that saves itself on blur and makes the save
 * state visible ("Unsaved" / "Saving…" / "Saved") — used for every
 * editable field in Planning (Website Summary, Operator Notes, Review
 * Summary) so the operator never has to wonder whether an edit stuck.
 * Uncontrolled by design: pass a new `key` from the parent when the
 * underlying value legitimately changes from outside (e.g. a fresh
 * analysis), same pattern the previous implementation used.
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
  const [status, setStatus] = useState<"idle" | "dirty" | "saving" | "saved">("idle");

  async function handleBlur(e: FocusEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    if (value === defaultValue) {
      setStatus("idle");
      return;
    }
    setStatus("saving");
    await onSave(value);
    setStatus("saved");
  }

  return (
    <div>
      <textarea
        defaultValue={defaultValue}
        onChange={() => setStatus("dirty")}
        onBlur={handleBlur}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled || status === "saving"}
        className={`w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm ${className}`}
      />
      <p className="mt-1 h-4 text-xs text-fg-subtle">
        {status === "saving"
          ? "Saving…"
          : status === "saved"
            ? "Saved"
            : status === "dirty"
              ? "Unsaved — click outside the field to save"
              : ""}
      </p>
    </div>
  );
}
