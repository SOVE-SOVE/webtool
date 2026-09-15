/**
 * A tiny inline busy indicator for a button/link that's mid-action.
 * Falls back to a static ring under reduced motion — still communicates
 * "busy," just without the spin.
 */
export function Spinner({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <span
      role="status"
      aria-hidden="true"
      className={`inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none ${className}`}
    />
  );
}
