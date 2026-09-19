"use client";

import { useRef } from "react";
import { CloseIcon } from "./ControlIcons";

export type FilterChip = {
  /** Stable key, e.g. the URL param name. */
  id: string;
  /** The criterion, e.g. "Status". */
  label: string;
  /** Its current value, e.g. "Won". */
  value: string;
  onRemove: () => void;
};

/**
 * The active filters of a CommandBar, as removable chips beneath it.
 * Renders nothing when no filter is active; "Clear all" appears only
 * alongside chips. Removing a chip hands keyboard focus to the chip that
 * takes its place, so a run of Enter presses can clear several in a row.
 */
export function FilterChips({ chips, onClearAll }: { chips: FilterChip[]; onClearAll?: () => void }) {
  const listRef = useRef<HTMLUListElement>(null);
  if (chips.length === 0) return null;

  function remove(chip: FilterChip, index: number) {
    chip.onRemove();
    requestAnimationFrame(() => {
      const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-chip-remove]");
      if (buttons?.length) buttons[Math.min(index, buttons.length - 1)].focus();
    });
  }

  return (
    <ul ref={listRef} aria-label="Active filters" className="flex flex-wrap items-center gap-2">
      {chips.map((chip, i) => (
        <li key={chip.id} className="chip animate-fade-in">
          <span className="text-fg-muted">{chip.label}:</span>
          <span className="truncate font-medium">{chip.value}</span>
          <button
            type="button"
            data-chip-remove
            aria-label={`Remove filter ${chip.label}: ${chip.value}`}
            onClick={() => remove(chip, i)}
            className="ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/40"
          >
            <CloseIcon className="h-3 w-3" />
          </button>
        </li>
      ))}
      {onClearAll && (
        <li>
          <button
            type="button"
            onClick={onClearAll}
            className="h-7 rounded-md px-2 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/40"
          >
            Clear all
          </button>
        </li>
      )}
    </ul>
  );
}
