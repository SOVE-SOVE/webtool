import type { ReactNode } from "react";

/**
 * The standard top-of-page block: title, an optional one-line
 * description, and optional primary action(s) on the right. Every major
 * page uses this so headers line up and read the same way instead of
 * each page hand-rolling its own `<h1>` + `<p>` + button row.
 */
export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  /** Primary action(s), right-aligned on desktop, wrapping below the title on narrow screens. */
  actions?: ReactNode;
  /** Extra content that belongs directly under the header (e.g. a tab bar). */
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-subtitle max-w-2xl">{description}</p>}
        {children && <div className="mt-3">{children}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
