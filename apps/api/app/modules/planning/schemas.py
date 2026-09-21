import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.modules.review_intelligence.schemas import ReviewIntelligenceResultRead


class ReviewWebsiteOpportunityRead(BaseModel):
    recommendation: str
    based_on_theme: str


class ReviewFaqOpportunityRead(BaseModel):
    question: str
    based_on_theme: str
    needs_owner_confirmation: bool = True


class ReviewWebsiteGapRead(BaseModel):
    gap: str
    based_on_theme: str


class KeyPointRead(BaseModel):
    # Deliberately plain `str` rather than a Literal for area/severity —
    # agents/planning_audit.py's deterministic findings always use a
    # known set, but agents/planning_visual_review.py's LLM-produced
    # findings must never fail to save just because the model phrased a
    # category slightly differently than expected.
    area: str
    category: str
    severity: str
    message: str
    evidence: str
    confidence: float


class PriorityPageRead(BaseModel):
    title: str
    purpose: str


class ComparablePatternRead(BaseModel):
    pattern: str
    evidence: str


class ComparableOpportunityRead(BaseModel):
    opportunity: str
    rationale: str


SocialFieldSource = Literal["discovered_business", "operator_entered", "meta_enrichment"]


class PlanningSocialProfileRead(BaseModel):
    """
    Computed, never a real column — built by
    service._build_social_profile_read from LeadPlanning's own
    instagram_*/facebook_* columns (when *_source is set) falling back to
    the linked DiscoveredBusiness's Instagram fields otherwise. Every
    value here is paired with where it came from, so the UI can label
    each fact rather than presenting it as a bare assumption.
    """

    instagram_handle: str | None = None
    instagram_profile_url: str | None = None
    instagram_bio: str | None = None
    instagram_bio_link_url: str | None = None
    instagram_profile_image_url: str | None = None
    instagram_follower_count: int | None = None
    instagram_source: SocialFieldSource | None = None
    instagram_verified_at: datetime | None = None

    facebook_page_url: str | None = None
    facebook_page_name: str | None = None
    facebook_bio: str | None = None
    facebook_source: SocialFieldSource | None = None
    facebook_verified_at: datetime | None = None

    has_any: bool = False


class UpdateSocialProfileRequest(BaseModel):
    """Operator-editable Social Presence fields only — follower counts,
    the profile image, and last-post time are never hand-typed, so they
    have no place here."""

    instagram_handle: str | None = None
    instagram_profile_url: str | None = None
    instagram_bio: str | None = None
    instagram_bio_link_url: str | None = None
    facebook_page_url: str | None = None
    facebook_page_name: str | None = None
    facebook_bio: str | None = None


# --- Build Brief: Keep / Improve / Add -------------------------------------

RecommendationCategoryLiteral = Literal["keep", "improve", "add"]
RecommendationSourceTypeLiteral = Literal[
    "audit_finding", "review_theme", "social_presence", "business_info", "comparable_research", "operator"
]
RecommendationStatusLiteral = Literal["proposed", "accepted", "dismissed"]


class RecommendationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    category: RecommendationCategoryLiteral
    title: str
    explanation: str
    source_type: RecommendationSourceTypeLiteral
    source_evidence: str | None
    status: RecommendationStatusLiteral
    order_index: int
    created_at: datetime
    updated_at: datetime


class CreateRecommendationRequest(BaseModel):
    category: RecommendationCategoryLiteral
    title: str
    explanation: str
    source_evidence: str | None = None


class UpdateRecommendationRequest(BaseModel):
    title: str | None = None
    explanation: str | None = None
    status: RecommendationStatusLiteral | None = None


# --- Build Brief: Proposed Sitemap and Homepage Outline ---------------------


class SitemapPageProposalRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    order_index: int
    title: str
    page_type: str
    purpose: str
    reason: str
    key_sections: list[str]
    needs_confirmation: bool
    created_at: datetime
    updated_at: datetime


class CreateSitemapPageRequest(BaseModel):
    title: str
    page_type: str = "custom"
    purpose: str
    reason: str = ""
    key_sections: list[str] = []
    needs_confirmation: bool = False


class UpdateSitemapPageRequest(BaseModel):
    title: str | None = None
    page_type: str | None = None
    purpose: str | None = None
    reason: str | None = None
    key_sections: list[str] | None = None
    needs_confirmation: bool | None = None


class SitemapPageOrderItem(BaseModel):
    id: uuid.UUID
    order_index: int


class ReorderSitemapPagesRequest(BaseModel):
    pages: list[SitemapPageOrderItem]


# --- Build Brief: Visual Direction Choices ----------------------------------


class VisualDirectionOptionRead(BaseModel):
    character: str
    typography: str
    colour_palette: str
    imagery: str
    layout: str


class SelectVisualDirectionRequest(BaseModel):
    """`option_index` picks a generated candidate as the baseline; any of
    the 5 fields provided alongside it overlay an edit on top in the same
    call. Omitting `option_index` edits the already-selected direction
    in place (400 if nothing has been selected yet)."""

    option_index: int | None = None
    character: str | None = None
    typography: str | None = None
    colour_palette: str | None = None
    imagery: str | None = None
    layout: str | None = None


# --- Build Brief: Assets Checklist ------------------------------------------

AssetStatusLiteral = Literal["ready_to_use", "reference_only", "needs_owner_approval", "missing"]


class AssetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    category: str
    label: str
    status: AssetStatusLiteral
    note: str | None
    created_at: datetime
    updated_at: datetime


class CreateAssetRequest(BaseModel):
    category: str
    label: str
    status: AssetStatusLiteral = "missing"
    note: str | None = None


class UpdateAssetRequest(BaseModel):
    label: str | None = None
    status: AssetStatusLiteral | None = None
    note: str | None = None


# --- Build Brief: compiled preview + approval -------------------------------


class BuildBriefFactRead(BaseModel):
    fact: str
    source: str


class BuildBriefSyncConflictRead(BaseModel):
    """One Planning change the last re-approval couldn't apply to the
    handed-off Project because the Project has its own edit (or the
    artefact is approved / regenerated) — see planning/handoff_sync.py.
    Values are truncated previews."""

    area: str
    item: str
    planning_value: str
    project_value: str
    message: str


class BuildBriefRead(BaseModel):
    """The live, always-current compiled brief (service.compute_build_brief)
    — never the frozen approved snapshot itself. `is_approved`/`approved_at`/
    `approved_by_user_id`/`project_id` report the state of the most recent
    approval, if any; approving again re-snapshots whatever this preview
    currently shows and, once a Project exists, pushes what changed to it.
    `sync_conflicts` lists what that push left alone."""

    objective: str | None
    confirmed_facts: list[BuildBriefFactRead]
    accepted_recommendations: list[RecommendationRead]
    sitemap: list[SitemapPageProposalRead]
    visual_direction: VisualDirectionOptionRead | None
    content_priorities: list[str]
    contact_priorities: list[str]
    visual_priorities: list[str]
    assets: list[AssetRead]
    open_questions: list[str]
    is_approved: bool
    approved_at: datetime | None
    approved_by_user_id: uuid.UUID | None
    project_id: uuid.UUID | None
    sync_conflicts: list[BuildBriefSyncConflictRead] = []


# --- Content Draft -----------------------------------------------------

ContentSourceLiteral = Literal["generated", "operator_edited"]
ContentPageStatusLiteral = Literal["draft", "edited", "approved"]


class ContentSectionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    order_index: int
    section_type: str
    content: dict
    needs_confirmation_notes: list[str]
    source: ContentSourceLiteral
    created_at: datetime
    updated_at: datetime


class ContentPageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    sitemap_page_id: uuid.UUID
    seo_title: str | None
    seo_meta_description: str | None
    status: ContentPageStatusLiteral
    approved_at: datetime | None
    approved_by_user_id: uuid.UUID | None
    sections: list[ContentSectionRead]
    created_at: datetime
    updated_at: datetime

    # Computed in service._content_page_read by recomputing the same
    # fingerprint fresh and comparing to approved_source_fingerprint —
    # never a stored column. True only while status == "approved" AND
    # a relevant upstream input (objective, accepted KIA, this page's
    # own sitemap purpose/reason, the selected visual direction) has
    # changed since approval. The stored status/content are never
    # touched by this — it's a flag, not a rewrite.
    stale: bool = False


class UpdateContentSectionRequest(BaseModel):
    content: dict


class UpdateContentPageSeoRequest(BaseModel):
    seo_title: str | None = None
    seo_meta_description: str | None = None


class ContentSectionPreviewRead(BaseModel):
    """Returned instead of a PlanningRead when regenerating a section
    that's been operator-edited, or whose page is already approved —
    NOT persisted. The operator must explicitly apply-preview (or
    discard by simply not calling it) before anything changes."""

    section_id: uuid.UUID
    candidate_content: dict
    candidate_needs_confirmation_notes: list[str]


class ApplyContentSectionPreviewRequest(BaseModel):
    content: dict
    needs_confirmation_notes: list[str] = []


class PlanningComparableSiteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    business_name: str
    website_url: str
    business_category: str | None
    location_text: str | None
    source_provider: str
    source_evidence: str | None
    included: bool
    fetch_ok: bool | None
    created_at: datetime


class PlanningRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    lead_id: uuid.UUID
    # Set once transferred to a Project — see PlanningListItem's own
    # docstring for this field. Not a real LeadPlanning attribute
    # (model_validate can't see it) — always explicitly overwritten by
    # _to_read right after validation; the default here just lets
    # model_validate succeed without it.
    project_id: uuid.UUID | None = None
    website_url: str | None
    website_audit_id: uuid.UUID | None
    status: Literal["ready_to_analyse", "analysing", "completed", "needs_review", "failed"]
    website_summary: str | None
    key_points: list[KeyPointRead]
    operator_notes: str | None
    error_message: str | None
    current_step: Literal["structure", "mobile", "technical", "visual", "summary"] | None
    created_at: datetime
    analysed_at: datetime | None
    updated_at: datetime

    # Denormalized from the parent Lead's Business, purely so the
    # standalone Planning workspace header can show a business name
    # without a second request — set in service._to_read, never a real
    # column on LeadPlanning.
    lead_business_name: str = ""

    # Denormalized from the backing WebsiteAudit, when one exists, so the
    # frontend can render evidence/screenshots without a second request.
    has_existing_site: bool | None = None
    screenshot_desktop_base64: str | None = None
    screenshot_mobile_base64: str | None = None
    detected_technology: str | None = None

    # "Google Review Insights" (docs/05_DECISIONS.md) — reputation snapshot
    # and customer themes are the latest ReviewIntelligenceResult for this
    # Lead, served as-is (see modules/review_intelligence); the remaining
    # fields are this workspace's own synthesis
    # (agents/planning_review_insights.py), empty until "Run Review
    # Insights" has been used at least once.
    review_intelligence: ReviewIntelligenceResultRead | None = None
    review_summary: str | None = None
    review_website_opportunities: list[ReviewWebsiteOpportunityRead] = []
    review_faq_opportunities: list[ReviewFaqOpportunityRead] = []
    review_website_gaps: list[ReviewWebsiteGapRead] = []
    review_insights_generated_at: datetime | None = None

    # "New Website Plan" mode — for a Lead with no website_audit yet.
    # See LeadPlanning's own docstring in models.py: the mode itself is
    # derived (website_audit_id is None), never stored.
    recommended_objective: str | None = None
    priority_pages: list[PriorityPageRead] = []
    content_priorities: list[str] = []
    contact_priorities: list[str] = []
    visual_priorities: list[str] = []
    open_questions: list[str] = []
    website_plan_generated_at: datetime | None = None

    # "Research Comparable Websites" — optional, inside New Website Plan
    # mode. comparable_sites are the candidate rows the operator curates;
    # the patterns/opportunities below are this workspace's synthesis
    # over whichever of those were included and successfully fetched.
    comparable_research_status: Literal["ready_for_review", "analysing", "completed", "needs_review", "failed"] | None = (
        None
    )
    comparable_research_error: str | None = None
    comparable_sites: list[PlanningComparableSiteRead] = []
    comparable_research_patterns: list[ComparablePatternRead] = []
    comparable_research_opportunities: list[ComparableOpportunityRead] = []
    comparable_research_generated_at: datetime | None = None

    # Social Presence — Instagram/Facebook input for the website-plan
    # agent, always present (empty when nothing is available yet). See
    # PlanningSocialProfileRead's own docstring.
    social_profile: PlanningSocialProfileRead = PlanningSocialProfileRead()

    # Build Brief — Keep/Improve/Add, proposed sitemap, visual direction
    # choices, assets checklist. Mode-agnostic (docs/05_DECISIONS.md);
    # never touches the New-Website-Plan-only fields above.
    recommendations_objective: str | None = None
    recommendations_generated_at: datetime | None = None
    recommendations: list[RecommendationRead] = []

    sitemap_proposal_generated_at: datetime | None = None
    sitemap_pages: list[SitemapPageProposalRead] = []

    visual_direction_options: list[VisualDirectionOptionRead] = []
    selected_visual_direction: VisualDirectionOptionRead | None = None
    visual_directions_generated_at: datetime | None = None

    assets_checklist_generated_at: datetime | None = None
    assets: list[AssetRead] = []

    # Content Draft — job-queued (see JOB_CONTENT_DRAFT_GENERATE).
    # content_draft_status is null until generation is first triggered.
    content_draft_status: Literal["generating", "completed", "needs_review", "failed"] | None = None
    content_draft_progress_label: str | None = None
    content_draft_generated_at: datetime | None = None
    content_draft_error: str | None = None
    content_pages: list[ContentPageRead] = []


class RegenerateContentSectionResponse(BaseModel):
    """Exactly one of `planning`/`preview` is set — `is_preview` says
    which. `planning` (an immediate replace) for a still-untouched
    section on a not-yet-approved page; `preview` (nothing persisted
    yet) for a section that's been edited, or whose page is approved."""

    is_preview: bool
    planning: PlanningRead | None = None
    preview: ContentSectionPreviewRead | None = None


class PlanningListItem(BaseModel):
    """Lighter shape for list views (workspace-wide and per-lead) — omits
    the two base64 screenshots, which are only needed on the detail page."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    lead_id: uuid.UUID
    lead_business_name: str
    website_url: str | None
    status: Literal["ready_to_analyse", "analysing", "completed", "needs_review", "failed"]
    # The two other background-job-like statuses on this row — carried
    # here (in addition to `status`) so a workspace-wide view (the
    # background activity panel) can see every running/failed job
    # without an extra per-item fetch; already loaded by the same query,
    # just not previously projected onto this response shape.
    comparable_research_status: Literal["ready_for_review", "analysing", "completed", "needs_review", "failed"] | None
    content_draft_status: Literal["generating", "completed", "needs_review", "failed"] | None
    content_draft_progress_label: str | None
    # Set once this Planning item's approved Build Brief has produced a
    # Project (LeadPlanningApprovedBrief.project_id) — "transferred to
    # Project." Computed, not a stored status: see
    # planning/service.py::create_project_from_planning.
    project_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    analysed_at: datetime | None
    # Set only when an audit is actually attached — the same signal the
    # detail page's own `planningMode()` reads (website_audit_id !==
    # null → "existing website" mode), exposed here without pulling in
    # the audit's own (large) screenshot payloads.
    website_audit_id: uuid.UUID | None
    # Presence only — never the screenshot itself. The card grid fetches
    # the actual image, if any, from the dedicated thumbnail route
    # (GET /api/v1/planning/{id}/screenshot) so this list response never
    # carries a base64 payload.
    has_screenshot: bool
    lead_industry: str | None
    lead_suburb: str | None
    lead_state: str | None
    # New Website Plan mode's own "has a plan been generated yet" signal
    # (mirrors detail page's OverviewTab: a website_url present but no
    # plan yet still resolves to "Analyse Website", not "Generate Website
    # Plan") — needed so the list can pick the same primary action label
    # without a second per-item fetch.
    website_plan_generated_at: datetime | None


class PlanningChecklistSummary(BaseModel):
    """One planning item's checklist progress — the workspace-wide,
    counts-only sibling of the per-item StageChecklistRead, mirroring
    Clients' own list_checklist_summaries so the Planning grid can show
    progress without an N+1 fetch. `next_item_title` is the same
    "what's actionable next" the per-item checklist already computes
    (_next_action), just the title string rather than the whole item."""

    planning_id: uuid.UUID
    completed: int
    total: int
    pct: int | None
    next_item_title: str | None


class AnalysePlanningRequest(BaseModel):
    """Body for the explicit "Analyse Website" action — only meaningful
    when the workspace doesn't already have a website_url on record."""

    website_url: str | None = None


class UpdatePlanningRequest(BaseModel):
    website_summary: str | None = None
    operator_notes: str | None = None
    review_summary: str | None = None


class UpdateComparableSiteRequest(BaseModel):
    included: bool
