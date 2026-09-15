"use client";

import { useEffect, useRef, useState, type FocusEvent } from "react";
import { SaveStatus, type SaveStatusValue } from "@/components/ui/SaveStatus";

/**
 * Single-line counterpart to AutoSaveTextarea — same save-on-blur
 * behaviour and visible status, for short fields (a handle, a URL, a
 * page name, a business name) where a multi-row textarea would be the
 * wrong shape.
 */
export function AutoSaveInput({
  defaultValue,
  onSave,
  placeholder,
  disabled = false,
  className = "",
}: {
  defaultValue: string;
  onSave: (value: string) => Promise<unknown> | void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [status, setStatus] = useState<SaveStatusValue>("idle");
  const revertTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (revertTimeout.current) clearTimeout(revertTimeout.current);
  }, []);

  async function handleBlur(e: FocusEvent<HTMLInputElement>) {
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
      <input
        type="text"
        defaultValue={defaultValue}
        onChange={() => {
          if (revertTimeout.current) clearTimeout(revertTimeout.current);
          setStatus("dirty");
        }}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={disabled || status === "saving"}
        className={`w-full rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm ${className}`}
      />
      <SaveStatus status={status} dirtyText="Unsaved — click outside the field to save" className="mt-1" />
    </div>
  );
}
