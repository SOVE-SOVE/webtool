import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action,
  compact = false,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  /** Use inside a table cell / narrow list row instead of a standalone panel. */
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="px-3 py-8 text-center">
        <p className="text-sm font-medium text-fg">{title}</p>
        {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
        {action && <div className="mt-3 flex justify-center">{action}</div>}
      </div>
    );
  }

  return (
    <div className="card flex flex-col items-center justify-center px-6 py-12 text-center">
      <p className="text-sm font-medium text-fg">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-fg-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
