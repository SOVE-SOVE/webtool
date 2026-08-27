export function ErrorState({
  message,
  onRetry,
  compact = false,
}: {
  message: string;
  onRetry?: () => void;
  /** Inline banner instead of a standalone panel — for use above content that partially loaded. */
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        <span>{message}</span>
        {onRetry && (
          <button onClick={onRetry} className="shrink-0 font-medium underline hover:no-underline">
            Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="card flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <p className="text-sm text-fg-muted">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn btn-secondary">
          Try again
        </button>
      )}
    </div>
  );
}
