import type { ReactNode } from "react";
import type { OpportunityScoreResult, ReviewIntelligenceResult, WebsiteQualityAudit } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { ScoreCategoryBadge } from "@/components/ReviewStatusBadge";
import { findingCounts, plural, reviewPriority } from "@/lib/reviewBrief";

function Tile({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-surface px-3.5 py-2.5">
      <p className="text-xs text-fg-muted">{label}</p>
      <div className="mt-0.5 flex items-baseline gap-2">{children}</div>
      {hint && <div className="mt-1 flex min-h-5 flex-wrap items-center gap-1.5 text-xs text-fg-subtle">{hint}</div>}
    </div>
  );
}

const BIG = "text-2xl font-semibold tabular-nums leading-tight text-fg";
const BIG_MUTED = "text-2xl font-semibold leading-tight text-fg-subtle";

/**
 * The top-of-page glance strip: opportunity score, priority, website
 * audit severity/count, and Google review rating/count — the four
 * numbers a reviewer weighs first. Purely presentational; the detail
 * behind each lives in the cards below.
 */
export function ReviewSummaryStrip({
  score,
  audit,
  auditNote,
  reviews,
}: {
  score: OpportunityScoreResult | null;
  audit: WebsiteQualityAudit | null;
  /** Shown instead of a count when there is no audit ("Not applicable — no website", "Not run yet"). */
  auditNote: string;
  reviews: ReviewIntelligenceResult | null;
}) {
  const priority = reviewPriority(score?.category);
  const counts = audit ? findingCounts(audit.findings) : null;
  const hasRating = reviews?.data_status === "ok";

  return (
    <section aria-label="Review summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile
        label="Opportunity score"
        hint={
          score ? (
            <>
              <ScoreCategoryBadge category={score.category} />
              <span>{Math.round(score.confidence * 100)}% confidence</span>
            </>
          ) : (
            "Not scored yet"
          )
        }
      >
        {score && score.overall_score !== null ? (
          <>
            <span className={BIG}>{score.overall_score}</span>
            <span className="text-sm text-fg-muted">/ 100</span>
          </>
        ) : score ? (
          // The check couldn't complete: no score, which is not a zero.
          <span className={BIG_MUTED} title="The website check couldn't complete, so there is no score">Not assessed</span>
        ) : (
          <span className={BIG_MUTED}>—</span>
        )}
      </Tile>

      <Tile label="Priority" hint={priority ? "From the opportunity score" : "Needs a score first"}>
        {priority ? (
          <>
            <span className={BIG}>{priority.label}</span>
            <Badge tone={priority.tone} className="uppercase">
              {score?.category}
            </Badge>
          </>
        ) : (
          <span className={BIG_MUTED}>—</span>
        )}
      </Tile>

      <Tile
        label="Website audit"
        hint={
          counts ? (
            counts.critical + counts.high > 0 ? (
              <>
                {counts.critical > 0 && <Badge tone="danger">{counts.critical} critical</Badge>}
                {counts.high > 0 && <Badge tone="warning">{counts.high} high</Badge>}
              </>
            ) : counts.total > 0 ? (
              "No high-severity issues"
            ) : (
              "No issues found"
            )
          ) : (
            auditNote
          )
        }
      >
        {counts ? (
          <>
            <span className={BIG}>{counts.total}</span>
            <span className="text-sm text-fg-muted">{counts.total === 1 ? "finding" : "findings"}</span>
          </>
        ) : (
          <span className={BIG_MUTED}>—</span>
        )}
      </Tile>

      <Tile
        label="Google reviews"
        hint={
          hasRating && reviews ? (
            <span>
              {reviews.google_review_count !== null ? plural(reviews.google_review_count, "review") : "Count unavailable"}
              {reviews.review_health_score !== null && ` · Health ${reviews.review_health_score}/100`}
            </span>
          ) : reviews ? (
            reviews.data_status === "no_listing" ? "No Google listing found" : "Google Places unavailable"
          ) : (
            "Not analyzed yet"
          )
        }
      >
        {hasRating && reviews?.google_rating != null ? (
          <>
            <span className={BIG}>{reviews.google_rating.toFixed(1)}</span>
            <span aria-hidden="true" className="text-lg text-amber-500">
              ★
            </span>
          </>
        ) : (
          <span className={BIG_MUTED}>—</span>
        )}
      </Tile>
    </section>
  );
}
