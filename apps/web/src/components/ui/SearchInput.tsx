"use client";

import { forwardRef, useImperativeHandle, useRef, type ComponentPropsWithoutRef } from "react";
import { CloseIcon, SearchIcon } from "./ControlIcons";

type Props = Omit<ComponentPropsWithoutRef<"input">, "type" | "value" | "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
  /** Marks the field invalid (danger border + `aria-invalid`). */
  invalid?: boolean;
};

/**
 * The compact search field of a CommandBar: leading magnifier, borderless
 * native `type="search"` input, and a clear button once there's text.
 * Escape clears a non-empty field (and only then — an empty field lets
 * Escape bubble so it still closes whatever surrounds it).
 *
 * Takes the value as a plain string via `onValueChange` rather than a
 * ChangeEvent, so clearing (which has no event) goes through the same
 * path as typing. `className` lands on the outer wrapper.
 */
export const SearchInput = forwardRef<HTMLInputElement, Props>(function SearchInput(
  { value, onValueChange, invalid, className = "", disabled, ...rest },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

  return (
    <div className={`control flex items-center gap-2 ${className}`}>
      <SearchIcon className="h-4 w-4 shrink-0 text-fg-subtle" />
      <input
        {...rest}
        ref={inputRef}
        type="search"
        value={value}
        disabled={disabled}
        aria-label={rest["aria-label"] ?? rest.placeholder}
        aria-invalid={invalid || undefined}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={(e) => {
          rest.onKeyDown?.(e);
          if (e.key === "Escape" && value && !e.defaultPrevented) {
            e.stopPropagation();
            onValueChange("");
          }
        }}
        className="control-bare"
      />
      {value && !disabled && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onValueChange("");
            inputRef.current?.focus();
          }}
          className="-mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/40"
        >
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
});
