export function CountBadge({ count, className = "ml-auto" }: { count: number | undefined; className?: string }) {
  if (!count) return null;
  return (
    <span className={`shrink-0 rounded-full bg-surface-subtle px-1.5 py-0 text-[11px] font-medium text-fg-muted ${className}`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}
