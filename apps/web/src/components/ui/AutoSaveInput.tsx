"use client";

import { useEffect, useRef, useState, type FocusEvent } from "react";
import { Input } from "@/components/ui/Input";
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

  function handleBlur(e: FocusEvent<HTMLInputElement>) {
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
      <Input
        type="text"
        defaultValue={defaultValue}
        onChange={() => {
          if (revertTimeout.current) clearTimeout(revertTimeout.current);
          setStatus("dirty");
        }}
        onBlur={handleBlur}
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
