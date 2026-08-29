export function ProgressBar({
  value,
  label,
  className = "",
}: {
  /** 0–100. Clamped. */
  value: number;
  label?: React.ReactNode;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={className}>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-subtle"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      {label && <p className="mt-1 text-xs text-fg-muted">{label}</p>}
    </div>
  );
}
