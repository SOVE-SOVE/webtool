import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, Boolean, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.leads.models import Lead
    from app.modules.review_intelligence.models import ReviewIntelligenceResult
    from app.modules.website_audits.models import WebsiteAudit


class PlanningStatus(str, enum.Enum):
    READY_TO_ANALYSE = "ready_to_analyse"
    ANALYSING = "analysing"
    COMPLETED = "completed"
    NEEDS_REVIEW = "needs_review"
    FAILED = "failed"


class ComparableResearchStatus(str, enum.Enum):
    """
    "Research Comparable Websites" — an optional, separate action inside
    New Website Plan mode (docs/05_DECISIONS.md). Search is synchronous
    (one discovery-provider call, same as a normal Discovery search), so
    READY_FOR_REVIEW is reached directly; ANALYSING is the only stage
    backed by a background job (JOB_PLANNING_COMPARABLE_ANALYSIS), since
    that's the part that fetches each included site's public homepage.
    """

    READY_FOR_REVIEW = "ready_for_review"
    ANALYSING = "analysing"
    COMPLETED = "completed"
    NEEDS_REVIEW = "needs_review"
    FAILED = "failed"


class PlanningAnalysisStep(str, enum.Enum):
    """
    Real, observable checkpoints inside run_analysis_job (service.py) —
    each one is set exactly when that phase of the actual pipeline
    starts, not a simulated/timed guess. Powers the "During audit"
    progress list on the frontend; never touched outside that one job
    function. Only meaningful while status is ANALYSING — cleared
    (None) once the run finishes, one way or another.
    """

    STRUCTURE = "structure"  # fetch_planning_audit_signals: desktop pass (DOM/meta/perf signals)
    MOBILE = "mobile"  # fetch_planning_audit_signals: tablet/mobile viewport pass + mobile screenshot
    TECHNICAL = "technical"  # deterministic Finding checks (planning_audit_agent) + audit record saved
    VISUAL = "visual"  # screenshot-grounded LLM visual/usability review
    SUMMARY = "summary"  # Website Summary paragraph (LLM) + finalizing the workspace


class LeadPlanning(Base):
    """
    "Planning": one standalone workspace per Lead for understanding its
    existing website — separate from the Lead page itself
    (docs/05_DECISIONS.md). "Start Planning" on the Lead creates this
    row (or opens it if it already exists — `lead_id` is unique, so
    there is never more than one per lead); it does NOT run an audit.
    "Analyse Website", a distinct action taken inside Planning, is what
    actually enqueues the background job. Re-analysing updates this
    same row in place (new findings/summary/website_audit_id each time)
    rather than creating a new history entry — the workspace is a
    living thing, not an append-only log.

    `website_url` starts out as whatever the lead's business has on
    record (possibly None) and can be set/overridden here — an operator
    can type one in for a lead that has none, and it need not match
    `business.website_url`. `website_summary` / `operator_notes` are
    freely editable after a run completes; `key_points` is a snapshot
    of the backing WebsiteAudit's findings and always reflects
    `website_audit_id`.
    """

    __tablename__ = "lead_planning"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lead_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), unique=True)
    website_url: Mapped[str | None] = mapped_column(String(500))
    website_audit_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("website_audits.id", ondelete="SET NULL"))
    status: Mapped[PlanningStatus] = mapped_column(
        Enum(PlanningStatus, name="planning_status"), default=PlanningStatus.READY_TO_ANALYSE
    )
    website_summary: Mapped[str | None] = mapped_column(Text)
    key_points: Mapped[list] = mapped_column(JSON, default=list)
    operator_notes: Mapped[str | None] = mapped_column(Text)
    error_message: Mapped[str | None] = mapped_column(Text)
    current_step: Mapped[PlanningAnalysisStep | None] = mapped_column(
        Enum(PlanningAnalysisStep, name="planning_analysis_step")
    )

    # "Google Review Insights" (docs/05_DECISIONS.md) — reuses
    # modules/review_intelligence entirely for the reputation snapshot,
    # customer themes, and the neutral review summary (copied here,
    # editable, same pattern as website_summary below). Only
    # review_website_opportunities/review_faq_opportunities/
    # review_website_gaps are genuinely new: a synthesis step
    # (agents/planning_review_insights.py) that cross-references the
    # verified review themes above against this same workspace's own
    # website-audit findings (key_points) — never run standalone, and
    # empty whenever there are no audit findings yet to compare against.
    review_intelligence_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("review_intelligence_results.id", ondelete="SET NULL")
    )
    review_summary: Mapped[str | None] = mapped_column(Text)
    review_website_opportunities: Mapped[list] = mapped_column(JSON, default=list)
    review_faq_opportunities: Mapped[list] = mapped_column(JSON, default=list)
    review_website_gaps: Mapped[list] = mapped_column(JSON, default=list)
    review_insights_generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # "New Website Plan" mode (docs/05_DECISIONS.md) — for a Lead with no
    # website to audit. Reuses website_summary above as its "Planning
    # Summary" and operator_notes as-is; key_points stays empty here
    # (it's audit-shaped — area/severity/evidence — and doesn't fit a
    # recommendation, so it's simply unused rather than overloaded).
    # Derived mode, not stored: a workspace is in this mode whenever
    # website_audit_id is still None (see modules/planning/service.py).
    recommended_objective: Mapped[str | None] = mapped_column(Text)
    priority_pages: Mapped[list] = mapped_column(JSON, default=list)
    content_priorities: Mapped[list] = mapped_column(JSON, default=list)
    contact_priorities: Mapped[list] = mapped_column(JSON, default=list)
    visual_priorities: Mapped[list] = mapped_column(JSON, default=list)
    open_questions: Mapped[list] = mapped_column(JSON, default=list)
    website_plan_generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # "Research Comparable Websites" — optional, inside New Website Plan
    # mode. See LeadPlanningComparableSite below for the candidate rows
    # themselves; these are just the synthesis output + status.
    comparable_research_status: Mapped[ComparableResearchStatus | None] = mapped_column(
        Enum(ComparableResearchStatus, name="comparable_research_status")
    )
    comparable_research_error: Mapped[str | None] = mapped_column(Text)
    comparable_research_patterns: Mapped[list] = mapped_column(JSON, default=list)
    comparable_research_opportunities: Mapped[list] = mapped_column(JSON, default=list)
    comparable_research_generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    analysed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    lead: Mapped["Lead"] = relationship()
    website_audit: Mapped["WebsiteAudit | None"] = relationship()
    review_intelligence: Mapped["ReviewIntelligenceResult | None"] = relationship()
    comparable_sites: Mapped[list["LeadPlanningComparableSite"]] = relationship(
        back_populates="lead_planning",
        cascade="all, delete-orphan",
        order_by="LeadPlanningComparableSite.created_at",
    )


class LeadPlanningComparableSite(Base):
    """
    One candidate reference site for "Research Comparable Websites"
    (New Website Plan mode). Deliberately its own table, not a row in
    `discovered_businesses` — these are public reference competitors for
    one Planning workspace's market context, never prospects, and must
    never surface in the Review Queue or Leads. Cascade-deletes with the
    Planning row, same "safe remove" semantics as its backing
    WebsiteAudit.

    `source_provider` is only ever "google_places" or "brave_search" —
    the same web-search discovery adapters Discovery already uses
    (modules/planning/service.py calls them directly, bypassing the CRM
    discovery pipeline entirely). Never "instagram_search": comparable
    research must never touch Instagram, scraped or otherwise.
    """

    __tablename__ = "lead_planning_comparable_sites"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lead_planning_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("lead_planning.id", ondelete="CASCADE"))
    business_name: Mapped[str] = mapped_column(String(255))
    website_url: Mapped[str] = mapped_column(String(500))
    business_category: Mapped[str | None] = mapped_column(String(120))
    location_text: Mapped[str | None] = mapped_column(String(255))
    source_provider: Mapped[str] = mapped_column(String(50))
    # The provider's own short snippet — already-public search-result
    # text, not scraped page content. Traceability, same convention as
    # SalesAuditReport.sources_note.
    source_evidence: Mapped[str | None] = mapped_column(Text)
    # The operator curates the batch before it's analysed — unchecked
    # sites are skipped by JOB_PLANNING_COMPARABLE_ANALYSIS entirely.
    included: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    # Per-site outcome once analysis runs — None until then. A failed
    # fetch for one site never fails the whole batch.
    fetch_ok: Mapped[bool | None] = mapped_column(Boolean)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    lead_planning: Mapped["LeadPlanning"] = relationship(back_populates="comparable_sites")
