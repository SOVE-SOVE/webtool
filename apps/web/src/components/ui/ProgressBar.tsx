export function ProgressBar({
  value,
  label,
  valueText,
  className = "",
}: {
  /** 0–100. Clamped. */
  value: number;
  label?: React.ReactNode;
  /** Screen-reader text for the current value, e.g. "6 of 10 tasks
   * complete" — read instead of the bare percentage. */
  valueText?: string;
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
        aria-valuetext={valueText}
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>
      {label && <p className="mt-1 text-xs text-fg-muted">{label}</p>}
    </div>
  );
}
