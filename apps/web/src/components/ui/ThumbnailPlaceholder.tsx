/**
 * Stands in for a project/website preview image. No screenshot or
 * thumbnail capability exists anywhere in this codebase for a
 * generated website (the only screenshot feature belongs to a
 * different, unrelated part of the app — Planning's capture of a
 * lead's *existing* site during research) — this renders
 * unconditionally, not as a fallback for a failed fetch.
 */
export function ThumbnailPlaceholder({ label, className = "" }: { label: string; className?: string }) {
  return (
    <div
      className={`flex aspect-[16/10] w-full flex-col items-center justify-center gap-1 rounded bg-surface-subtle text-fg-subtle ${className}`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} className="h-6 w-6" aria-hidden="true">
        <rect x="3.5" y="5.5" width="17" height="13" rx="1.5" />
        <path d="M3.5 9.5h17M7 5.5v-1a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v1" />
      </svg>
      <span className="truncate px-2 text-xs">{label}</span>
    </div>
  );
}
