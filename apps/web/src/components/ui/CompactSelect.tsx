"use client";

import { ChevronDownIcon } from "./ControlIcons";

export type SelectOption<T extends string = string> = { value: T; label: string; disabled?: boolean };

type Props<T extends string> = {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SelectOption<T>[];
  /** Accessible name. Not needed when the select sits inside a <label> (see FilterField). */
  "aria-label"?: string;
  /** Muted text shown before the value, e.g. "Sort". */
  prefix?: string;
  /** Shown when `value` matches no option. */
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  id?: string;
  name?: string;
  className?: string;
};

/**
 * A compact dropdown that keeps the browser's native <select> — so
 * keyboard, screen-reader and mobile-picker behaviour are all the real
 * thing — but paints it as a `.control`. The <select> is stretched
 * invisibly over the whole control (so the entire box, prefix and
 * chevron included, is the click target); what you *see* is a text span
 * mirroring the selected option.
 *
 * The visible text sits in a grid with every option's label stacked
 * invisibly beside it, so the control is as wide as its longest option
 * and doesn't resize as the selection changes. An option with value ""
 * (the "Any …" entry) renders muted, so an unset filter reads as unset.
 */
export function CompactSelect<T extends string>({
  value,
  onValueChange,
  options,
  prefix,
  placeholder = "",
  invalid,
  disabled,
  className = "",
  ...rest
}: Props<T>) {
  const selected = options.find((o) => o.value === value);
  const isUnset = !selected || selected.value === "";
  return (
    <div className={`control relative flex items-center gap-1.5 ${className}`}>
      {prefix && <span className="shrink-0 text-fg-muted">{prefix}</span>}
      <span aria-hidden="true" className={`grid min-w-0 flex-1 overflow-hidden text-left ${isUnset ? "text-fg-muted" : "text-fg"}`}>
        {options.map((o) => (
          <span key={o.value} className="invisible col-start-1 row-start-1 h-0 overflow-hidden whitespace-nowrap">
            {o.label}
          </span>
        ))}
        <span className="col-start-1 row-start-1 truncate">{selected?.label ?? placeholder}</span>
      </span>
      <ChevronDownIcon className="h-4 w-4 shrink-0 text-fg-subtle" />
      <select
        {...rest}
        value={value}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(e) => onValueChange(e.target.value as T)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * The Sort control of a CommandBar: a CompactSelect with a "Sort" prefix
 * and auto width, so it shrinks to fit beside the Filters button.
 */
export function SortSelect<T extends string>({
  className = "",
  "aria-label": ariaLabel = "Sort by",
  ...props
}: Omit<Props<T>, "prefix" | "placeholder">) {
  return <CompactSelect {...props} aria-label={ariaLabel} prefix="Sort" className={`w-auto ${className}`} />;
}
