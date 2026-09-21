import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, Boolean, DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.modules.sitemaps.models import PageType

if TYPE_CHECKING:
    from app.modules.leads.models import Lead
    from app.modules.review_intelligence.models import ReviewIntelligenceResult
    from app.modules.users.models import User
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


class ReviewSynthesisStatus(str, enum.Enum):
    """Outcome of the LATEST attempt at "Google Review Insights"'s
    synthesis step (agents/planning_review_insights.py) — nullable on
    LeadPlanning. Null means "no recorded outcome", NOT "never attempted":
    records from before this column existed were deliberately not
    backfilled, so a null status alongside a set `review_insights_generated_at`
    is a previous run whose synthesis outcome is unknown (see
    service._review_synthesis_interpretation). Success is never inferred
    from the content lists or timestamps.

    COMPLETED — the step ran and returned a valid result. The lists may
      legitimately be empty ("nothing to recommend"); that is a success.
    FAILED    — the AI call failed or returned an unusable response. The
      previous successful content, if any, is left in place; see
      `review_synthesis_succeeded_at` for how old it is.
    SKIPPED   — attempted, but there were no recurring review themes to
      synthesise from, so the AI was never called.
    """

    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


class SocialDataSource(str, enum.Enum):
    """
    Where an Instagram/Facebook field on this Planning row actually came
    from — shown to the operator as a source/confidence label, and the
    hook a future Meta-enrichment job would use: it would write directly
    into the instagram_*/facebook_* columns below and set the matching
    *_source to META_ENRICHMENT + *_verified_at to now, with no schema
    change needed. No such job exists yet — this enum member is unused
    until one is built.
    """

    DISCOVERED_BUSINESS = "discovered_business"
    OPERATOR_ENTERED = "operator_entered"
    META_ENRICHMENT = "meta_enrichment"


class RecommendationCategory(str, enum.Enum):
    """Keep / Improve / Add — see agents/planning_recommendations.py."""

    KEEP = "keep"
    IMPROVE = "improve"
    ADD = "add"


class RecommendationSourceType(str, enum.Enum):
    """Where a Keep/Improve/Add item's evidence came from — shown to the
    operator alongside it, same "always show the source" principle as
    Social Presence."""

    AUDIT_FINDING = "audit_finding"
    REVIEW_THEME = "review_theme"
    SOCIAL_PRESENCE = "social_presence"
    BUSINESS_INFO = "business_info"
    COMPARABLE_RESEARCH = "comparable_research"
    OPERATOR = "operator"


class RecommendationStatus(str, enum.Enum):
    """PROPOSED (generated, awaiting a decision) -> ACCEPTED or DISMISSED.
    Operator-authored rows start ACCEPTED — an operator adding their own
    item has already "decided" it belongs. Regeneration only ever adds
    new PROPOSED rows; it never changes an existing row's status."""

    PROPOSED = "proposed"
    ACCEPTED = "accepted"
    DISMISSED = "dismissed"


class AssetStatus(str, enum.Enum):
    """The Assets Checklist's 4-state distinction. A publicly-visible
    social image is always REFERENCE_ONLY, never READY_TO_USE — using it
    on the generated website still requires the owner's approval."""

    READY_TO_USE = "ready_to_use"
    REFERENCE_ONLY = "reference_only"
    NEEDS_OWNER_APPROVAL = "needs_owner_approval"
    MISSING = "missing"


class ContentDraftStatus(str, enum.Enum):
    """Content Draft's own generation-run status (docs/05_DECISIONS.md) —
    nullable on LeadPlanning; absent means generation has never been
    triggered. Mirrors PlanningStatus's shape (a status that means
    "a background job is running/settled"), separate from
    ContentPageStatus below (each page's own draft/edited/approved
    lifecycle, which regeneration must never silently reset)."""

    GENERATING = "generating"
    COMPLETED = "completed"
    NEEDS_REVIEW = "needs_review"
    FAILED = "failed"


class ContentPageStatus(str, enum.Enum):
    """One page's Content Draft lifecycle. DRAFT (freshly generated,
    untouched) -> EDITED (an operator changed a section) -> APPROVED
    (explicit page-level approval). Editing or applying a regenerated
    section on an APPROVED page reverts it to EDITED — the same
    edit-reverts-approval convention already used by
    CreativeDirectionBrief/Sitemap/DesignBrief."""

    DRAFT = "draft"
    EDITED = "edited"
    APPROVED = "approved"


class ContentSource(str, enum.Enum):
    """Whether a section's current content is the last thing the AI
    generated, or something an operator typed/applied by hand. Drives
    two rules: regenerate.py's "did anything a human touched" branch
    into a preview-first flow, and the top-level "Generate Content
    Draft" action's page-skip rule (a page is only ever regenerated in
    bulk while every one of its sections is still GENERATED)."""

    GENERATED = "generated"
    OPERATOR_EDITED = "operator_edited"


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
    # Latest synthesis attempt (see ReviewSynthesisStatus). The three lists
    # above are only ever replaced by a COMPLETED attempt, so after a
    # FAILED one they still hold the last successful content —
    # `review_synthesis_succeeded_at` says when that was, and
    # `review_synthesis_error` is a fixed, safe reason (never raw provider
    # text) for the latest failure.
    review_synthesis_status: Mapped[ReviewSynthesisStatus | None] = mapped_column(
        Enum(ReviewSynthesisStatus, name="review_synthesis_status")
    )
    review_synthesis_error: Mapped[str | None] = mapped_column(Text)
    review_synthesis_attempted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_synthesis_succeeded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

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

    # Social Presence (New Website Plan mode) — Instagram/Facebook input,
    # each platform independently null until an operator confirms/enters
    # it (or a future Meta-enrichment job runs) via *_source/*_verified_at.
    # While *_source is null, service._build_social_profile_read falls
    # back to the linked DiscoveredBusiness's Instagram fields (Discovery's
    # own Brave-search-derived data) for display and for the website-plan
    # agent's input — never scraped, never a live Instagram/Facebook
    # fetch. Facebook has no fallback source (no Facebook provider
    # exists): it is operator-entered only until real Meta enrichment
    # exists. instagram_profile_image_url/instagram_follower_count/
    # instagram_last_post_at are deliberately NOT stored here — they're
    # always read live from DiscoveredBusiness, since no operator would
    # usefully hand-type a follower count.
    instagram_handle: Mapped[str | None] = mapped_column(String(100))
    instagram_profile_url: Mapped[str | None] = mapped_column(String(500))
    instagram_bio: Mapped[str | None] = mapped_column(Text)
    instagram_bio_link_url: Mapped[str | None] = mapped_column(String(500))
    instagram_source: Mapped[SocialDataSource | None] = mapped_column(
        Enum(SocialDataSource, name="social_data_source")
    )
    instagram_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    facebook_page_url: Mapped[str | None] = mapped_column(String(500))
    facebook_page_name: Mapped[str | None] = mapped_column(String(255))
    facebook_bio: Mapped[str | None] = mapped_column(Text)
    facebook_source: Mapped[SocialDataSource | None] = mapped_column(
        Enum(SocialDataSource, name="social_data_source")
    )
    facebook_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Build Brief (docs/05_DECISIONS.md) — Keep/Improve/Add, a proposed
    # sitemap, visual direction choices, and an assets checklist, all
    # mode-agnostic (unlike recommended_objective/priority_pages above,
    # which stay New-Website-Plan-mode-only and untouched by this).
    # See LeadPlanningRecommendation/LeadPlanningSitemapPage/
    # LeadPlanningAsset/LeadPlanningApprovedBrief below for the actual
    # items — these columns are just the generation-run bookkeeping plus
    # the two fields (options / selection) that don't fit a child table.
    recommendations_objective: Mapped[str | None] = mapped_column(Text)
    recommendations_generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sitemap_proposal_generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Raw candidates from the last generation — fully replaced each time
    # (these are choices to pick FROM, not individually-owned items).
    visual_direction_options: Mapped[list] = mapped_column(JSON, default=list)
    # The chosen candidate plus any operator edits layered on top.
    # Regeneration never touches this once set — see
    # service.generate_visual_directions.
    selected_visual_direction: Mapped[dict | None] = mapped_column(JSON)
    visual_directions_generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    assets_checklist_generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Content Draft (docs/05_DECISIONS.md) — job-queued (see
    # JOB_CONTENT_DRAFT_GENERATE); the actual pages/sections live in
    # LeadPlanningContentPage/LeadPlanningContentSection below. These
    # columns are just the run's own bookkeeping. `content_draft_progress_label`
    # is free text (e.g. "Drafting Services (2 of 5)"), not a fixed-step
    # enum like PlanningAnalysisStep, since the number of pages varies
    # per plan — set once per page by the job, mirroring _set_step's
    # "commit immediately so a poll sees it mid-run" contract.
    content_draft_status: Mapped[ContentDraftStatus | None] = mapped_column(
        Enum(ContentDraftStatus, name="content_draft_status")
    )
    content_draft_progress_label: Mapped[str | None] = mapped_column(Text)
    content_draft_generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    content_draft_error: Mapped[str | None] = mapped_column(Text)

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
    recommendations: Mapped[list["LeadPlanningRecommendation"]] = relationship(
        back_populates="lead_planning",
        cascade="all, delete-orphan",
        order_by="LeadPlanningRecommendation.order_index",
    )
    sitemap_pages: Mapped[list["LeadPlanningSitemapPage"]] = relationship(
        back_populates="lead_planning",
        cascade="all, delete-orphan",
        order_by="LeadPlanningSitemapPage.order_index",
    )
    assets: Mapped[list["LeadPlanningAsset"]] = relationship(
        back_populates="lead_planning",
        cascade="all, delete-orphan",
        order_by="LeadPlanningAsset.created_at",
    )
    approved_brief: Mapped["LeadPlanningApprovedBrief | None"] = relationship(
        back_populates="lead_planning", cascade="all, delete-orphan", uselist=False
    )
    content_pages: Mapped[list["LeadPlanningContentPage"]] = relationship(
        back_populates="lead_planning",
        cascade="all, delete-orphan",
        order_by="LeadPlanningContentPage.created_at",
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


class LeadPlanningRecommendation(Base):
    """
    One Keep/Improve/Add item (Build Brief, docs/05_DECISIONS.md).
    Generated rows start PROPOSED; the operator accepts/dismisses/edits
    them, or adds their own (status ACCEPTED from the start). Regenerating
    (service.generate_recommendations) only ever INSERTS new rows whose
    title doesn't already match an existing one — it never edits or
    removes a row, so an operator's decision is never silently undone.
    """

    __tablename__ = "lead_planning_recommendations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lead_planning_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("lead_planning.id", ondelete="CASCADE"))
    category: Mapped[RecommendationCategory] = mapped_column(
        Enum(RecommendationCategory, name="recommendation_category")
    )
    title: Mapped[str] = mapped_column(String(255))
    explanation: Mapped[str] = mapped_column(Text)
    source_type: Mapped[RecommendationSourceType] = mapped_column(
        Enum(RecommendationSourceType, name="recommendation_source_type")
    )
    # The evidence itself (an audit finding's message, a review theme's
    # snippet, ...) — null for OPERATOR-sourced items with no cited
    # evidence.
    source_evidence: Mapped[str | None] = mapped_column(Text)
    status: Mapped[RecommendationStatus] = mapped_column(
        Enum(RecommendationStatus, name="recommendation_status"), default=RecommendationStatus.PROPOSED
    )
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    lead_planning: Mapped["LeadPlanning"] = relationship(back_populates="recommendations")


class LeadPlanningSitemapPage(Base):
    """
    One proposed page in the Build Brief's "Proposed Sitemap and Homepage
    Outline" (docs/05_DECISIONS.md) — deliberately mirrors
    modules/sitemaps.SitemapPage's vocabulary exactly (same `PageType`
    enum, same key_sections free-text-hint shape) so a page converts to
    a real SitemapPage at Create Project with zero translation. Lighter
    than the real SitemapPage: no slug/nav_placement/parent nesting/CTAs
    yet — those are exactly what the real Sitemap module's own generation
    step adds once a Project exists; this is the pre-Project proposal.
    Regenerating only adds new pages (same append-only rule as
    LeadPlanningRecommendation).
    """

    __tablename__ = "lead_planning_sitemap_pages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lead_planning_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("lead_planning.id", ondelete="CASCADE"))
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    title: Mapped[str] = mapped_column(String(255))
    page_type: Mapped[PageType] = mapped_column(Enum(PageType, name="sitemap_page_type"))
    purpose: Mapped[str] = mapped_column(Text)
    reason: Mapped[str] = mapped_column(Text)
    key_sections: Mapped[list] = mapped_column(JSON, default=list)
    # True when this page's content depends on services/copy not
    # actually confirmed anywhere in Planning's inputs.
    needs_confirmation: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    lead_planning: Mapped["LeadPlanning"] = relationship(back_populates="sitemap_pages")


class LeadPlanningAsset(Base):
    """
    One row of the Build Brief's Assets Checklist. `category` is a plain
    string, not an enum — the standard categories ("logo", "photos",
    "service_descriptions", "contact_details", "booking_destination")
    are seeded once by service.generate_assets_checklist from real
    records (Lead/Business contact fields, Social Presence), but an
    operator can add a custom one for anything the proposed sitemap
    needs beyond those. A publicly-visible social image is always seeded
    REFERENCE_ONLY, never READY_TO_USE (a website asset needs the
    owner's approval to use, not just public visibility). Refreshing the
    checklist only ever adds newly-relevant rows — an operator's status/
    note edit on an existing row is never touched.
    """

    __tablename__ = "lead_planning_assets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lead_planning_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("lead_planning.id", ondelete="CASCADE"))
    category: Mapped[str] = mapped_column(String(50))
    label: Mapped[str] = mapped_column(String(255))
    status: Mapped[AssetStatus] = mapped_column(Enum(AssetStatus, name="asset_status"))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    lead_planning: Mapped["LeadPlanning"] = relationship(back_populates="assets")


class LeadPlanningApprovedBrief(Base):
    """
    A frozen snapshot of the Build Brief at the moment the operator
    clicked "Approve Build Brief" (docs/05_DECISIONS.md) — the explicit
    gate `create_project_from_planning` now requires before it will
    create a Project. `project_id` is set once that handoff actually
    consumes this snapshot; a repeated "Create Project" click sees
    `project_id` already set and short-circuits to that same Project
    instead of creating a duplicate. Re-approving freely replaces this
    row's contents (upsert). Once `project_id` is set, a re-approval also
    pushes what changed to the Project — see planning/handoff_sync.py; the
    Project's own edits are kept and flagged, never overwritten.
    """

    __tablename__ = "lead_planning_approved_briefs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lead_planning_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("lead_planning.id", ondelete="CASCADE"), unique=True
    )
    objective: Mapped[str] = mapped_column(Text)
    confirmed_facts: Mapped[list] = mapped_column(JSON, default=list)
    accepted_recommendations: Mapped[list] = mapped_column(JSON, default=list)
    sitemap_snapshot: Mapped[list] = mapped_column(JSON, default=list)
    visual_direction_snapshot: Mapped[dict | None] = mapped_column(JSON)
    content_priorities: Mapped[list] = mapped_column(JSON, default=list)
    contact_priorities: Mapped[list] = mapped_column(JSON, default=list)
    visual_priorities: Mapped[list] = mapped_column(JSON, default=list)
    assets_snapshot: Mapped[list] = mapped_column(JSON, default=list)
    open_questions_snapshot: Mapped[list] = mapped_column(JSON, default=list)
    # Approved Content Draft pages/sections at approval time — same
    # snapshot convention as sitemap_snapshot/visual_direction_snapshot
    # above. Only ever contains pages that were APPROVED, never
    # draft/edited ones.
    content_draft_snapshot: Mapped[list] = mapped_column(JSON, default=list)
    approved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    approved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"))
    # Handoff bookkeeping (see planning/handoff_sync.py) — how later Planning
    # changes reach the Project. The two ids point at the Project rows the
    # handoff created (null for a handoff that predates them, or that had
    # nothing to seed); `handoff_baseline` is the last value Planning handed
    # over per field ({"design_brief", "sitemap", "creative_direction",
    # "build_direction"}), the base of the 3-way merge; `sync_conflicts` is the
    # last sync's list of Planning changes the Project's own edits blocked.
    seeded_sitemap_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("sitemaps.id", ondelete="SET NULL"))
    seeded_creative_direction_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("creative_direction_briefs.id", ondelete="SET NULL")
    )
    handoff_baseline: Mapped[dict | None] = mapped_column(JSON)
    sync_conflicts: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    lead_planning: Mapped["LeadPlanning"] = relationship(back_populates="approved_brief")
    approved_by_user: Mapped["User | None"] = relationship()


class LeadPlanningContentPage(Base):
    """
    Content Draft's per-page record (docs/05_DECISIONS.md) — one row per
    `LeadPlanningSitemapPage` once content exists for it. `status` is
    the ONE approval gate for everything on this page (individual
    sections don't have their own approval state, only their own
    `source` — see LeadPlanningContentSection). `approved_source_fingerprint`
    is a stable hash of the upstream inputs this page's copy depended on
    at approval time (objective, accepted KIA, this page's own sitemap
    purpose/reason, the selected visual direction) — service.py
    recomputes it fresh on every read and reports `stale=True` when it
    no longer matches, WITHOUT touching `status` or the stored content:
    "flag as needing review", never "silently rewrite".
    """

    __tablename__ = "lead_planning_content_pages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lead_planning_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("lead_planning.id", ondelete="CASCADE"))
    sitemap_page_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("lead_planning_sitemap_pages.id", ondelete="CASCADE")
    )
    seo_title: Mapped[str | None] = mapped_column(Text)
    seo_meta_description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[ContentPageStatus] = mapped_column(
        Enum(ContentPageStatus, name="content_page_status"), default=ContentPageStatus.DRAFT
    )
    approved_source_fingerprint: Mapped[str | None] = mapped_column(String(64))
    approved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    lead_planning: Mapped["LeadPlanning"] = relationship(back_populates="content_pages")
    sitemap_page: Mapped["LeadPlanningSitemapPage"] = relationship()
    approved_by_user: Mapped["User | None"] = relationship()
    sections: Mapped[list["LeadPlanningContentSection"]] = relationship(
        back_populates="content_page",
        cascade="all, delete-orphan",
        order_by="LeadPlanningContentSection.order_index",
    )


class LeadPlanningContentSection(Base):
    """
    One drafted section within a Content Draft page. `section_type` is
    deliberately one of the real packages/site-templates section type
    strings ("hero", "about", "serviceCards", "gallery", "contact",
    "cta", "faq") and `content` matches that type's real config shape
    exactly (e.g. {"heading":..., "subheading":...} for hero) — the same
    loosely-typed JSON convention agents/anti_slop.py's own
    SectionInput.config already uses, so an approved section needs zero
    translation to become a real one. `needs_confirmation_notes` is
    strictly internal (unanswered FAQ topics, missing-fact notes) and
    must never be serialized into real generator-facing output.
    """

    __tablename__ = "lead_planning_content_sections"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    content_page_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("lead_planning_content_pages.id", ondelete="CASCADE")
    )
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    section_type: Mapped[str] = mapped_column(String(50))
    content: Mapped[dict] = mapped_column(JSON, default=dict)
    needs_confirmation_notes: Mapped[list] = mapped_column(JSON, default=list)
    source: Mapped[ContentSource] = mapped_column(
        Enum(ContentSource, name="content_source"), default=ContentSource.GENERATED
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    content_page: Mapped["LeadPlanningContentPage"] = relationship(back_populates="sections")
