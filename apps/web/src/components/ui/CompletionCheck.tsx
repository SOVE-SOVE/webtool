/**
 * The small "done" tick shown beside a completed state's label. Static by
 * default; with `animate` it draws in once — the acknowledgement for a
 * completion the user just made (see lib/completionFeedback.ts). The
 * label carries the meaning either way, so it's hidden from assistive
 * tech.
 */
export function CompletionCheck({
  animate = false,
  onAnimationEnd,
  className = "",
}: {
  animate?: boolean;
  onAnimationEnd?: () => void;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      className={`inline-block size-3 fill-none stroke-current ${className}`}
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        d="M2.5 6.5 5 9l4.5-5.5"
        pathLength={1}
        className={animate ? "animate-check-draw" : undefined}
        onAnimationEnd={onAnimationEnd}
      />
    </svg>
  );
}
