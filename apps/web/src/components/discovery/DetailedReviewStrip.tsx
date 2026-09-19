import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { timeAgo } from "@/lib/format";

// A run-once/check-status pill shared by every analysis type on the
// review page (research/audit/score) — "clearly distinguish completed,
// pending, unavailable, and failed" is the explicit requirement this
// exists to satisfy, in one place rather than four ad hoc renderings.
export type CheckStatus = "not_run" | "running" | "done" | "failed" | "unavailable";
export type PipelineStep = "research" | "audit" | "score";

const CHECK_STATUS_TONE: Record<CheckStatus, BadgeTone> = {
  not_run: "muted",
  running: "info",
  done: "success",
  failed: "danger",
  unavailable: "muted",
};
const CHECK_STATUS_LABEL: Record<CheckStatus, string> = {
  not_run: "Not run yet",
  running: "Running…",
  done: "Completed",
  failed: "Failed",
  unavailable: "Not applicable",
};

export function CheckStatusBadge({ status }: { status: CheckStatus }) {
  return <Badge tone={CHECK_STATUS_TONE[status]}>{CHECK_STATUS_LABEL[status]}</Badge>;
}

type StepRow = { step: PipelineStep; label: string; status: CheckStatus; at: string | null };

/**
 * "Run Detailed Review" as one slim row — the action plus the three
 * per-step statuses (research → audit → score) it sequences — instead of
 * its own tall panel. Behaviour is unchanged: the parent owns the
 * pipeline; this only renders it.
 */
export function DetailedReviewStrip({
  rows,
  pipelineStep,
  hasRun,
  knownNoWebsite,
  onRun,
  onRetry,
}: {
  rows: StepRow[];
  pipelineStep: PipelineStep | null;
  hasRun: boolean;
  knownNoWebsite: boolean;
  onRun: () => void;
  onRetry: (step: PipelineStep) => void;
}) {
  return (
    <section
      aria-label="Detailed review"
      className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md border border-border bg-surface px-3.5 py-2.5"
    >
      <h2 className="text-sm font-semibold text-fg">Detailed review</h2>
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        {rows.map((row) => (
          <li key={row.step} className="flex items-center gap-1.5 text-xs text-fg-muted">
            <span>{row.label}</span>
            <CheckStatusBadge status={row.status} />
            {row.at && row.status === "done" && <span className="text-fg-subtle">{timeAgo(row.at)}</span>}
            {row.status === "failed" && (
              <button
                type="button"
                onClick={() => onRetry(row.step)}
                className="rounded font-medium text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                Retry
              </button>
            )}
          </li>
        ))}
      </ul>
      <button type="button" onClick={onRun} disabled={pipelineStep !== null} className="btn btn-primary btn-sm ml-auto">
        {pipelineStep
          ? `${pipelineStep === "research" ? "Researching" : pipelineStep === "audit" ? "Auditing" : "Scoring"}…`
          : hasRun
            ? "Run Detailed Review again"
            : "Run Detailed Review"}
      </button>
      {knownNoWebsite && (
        <p className="basis-full text-xs text-fg-subtle">
          No website on record for this business — the audit step focuses on business, review, and social evidence
          instead of website findings that don&rsquo;t apply here.
        </p>
      )}
    </section>
  );
}
