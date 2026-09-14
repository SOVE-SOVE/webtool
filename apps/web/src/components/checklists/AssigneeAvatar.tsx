function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * A compact initials circle + name for showing who a task is assigned
 * to. No avatar component exists elsewhere in this repo — this is the
 * minimal shared one, reused by both checklist systems' task rows.
 */
export function AssigneeAvatar({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className}`} title={name}>
      <span
        aria-hidden="true"
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[9px] font-medium text-accent"
      >
        {initials(name)}
      </span>
      <span className="truncate text-xs text-fg-muted">{name}</span>
    </span>
  );
}
