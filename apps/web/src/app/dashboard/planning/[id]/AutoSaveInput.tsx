"use client";

import { useState, type FocusEvent } from "react";
import { Input } from "@/components/ui/Input";

/**
 * Single-line counterpart to AutoSaveTextarea — same save-on-blur
 * behaviour and visible status, for short fields (a handle, a URL, a
 * page name) where a multi-row textarea would be the wrong shape.
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
  const [status, setStatus] = useState<"idle" | "dirty" | "saving" | "saved">("idle");

  async function handleBlur(e: FocusEvent<HTMLInputElement>) {
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
      <Input
        type="text"
        defaultValue={defaultValue}
        onChange={() => setStatus("dirty")}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={disabled || status === "saving"}
        className={`input ${className}`}
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
