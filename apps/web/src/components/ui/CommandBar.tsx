import type { ReactNode } from "react";

/**
 * The layout shell for a list page's controls: Search, the Filters
 * button and Sort in one row, with the active-filter chips underneath.
 * Pages hand it the pieces (SearchInput, FilterPopover, SortSelect,
 * FilterChips) and keep all their own filtering logic.
 *
 * At phone width Search takes its own full row and Filters/Sort share
 * the next one (Sort shrinks and truncates to fit). `end` (a view
 * toggle, a result count) pushes to the right edge on wider screens and
 * wraps below on narrow ones.
 */
export function CommandBar({
  search,
  filters,
  sort,
  end,
  chips,
  className = "",
}: {
  search: ReactNode;
  filters?: ReactNode;
  sort?: ReactNode;
  end?: ReactNode;
  chips?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 basis-full sm:max-w-sm sm:flex-1 sm:basis-64">{search}</div>
        {filters}
        {sort && <div className="max-sm:min-w-[9rem] max-sm:flex-1 max-sm:basis-0 max-sm:[&>.control]:w-full">{sort}</div>}
        {end && <div className="flex items-center gap-2 sm:ml-auto">{end}</div>}
      </div>
      {chips && <div className="mt-2.5">{chips}</div>}
    </div>
  );
}
