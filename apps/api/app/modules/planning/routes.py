import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.rate_limit import enforce_generation_rate_limit
from app.db.session import get_db
from app.integrations.discovery.base import ProviderUnavailableError
from app.modules.planning import service
from app.modules.planning.schemas import (
    AnalysePlanningRequest,
    ApplyContentSectionPreviewRequest,
    BuildBriefRead,
    CreateAssetRequest,
    CreateRecommendationRequest,
    CreateSitemapPageRequest,
    PlanningListItem,
    PlanningRead,
    RegenerateContentSectionResponse,
    ReorderSitemapPagesRequest,
    SelectVisualDirectionRequest,
    UpdateAssetRequest,
    UpdateComparableSiteRequest,
    UpdateContentPageSeoRequest,
    UpdateContentSectionRequest,
    UpdatePlanningRequest,
    UpdateRecommendationRequest,
    UpdateSitemapPageRequest,
    UpdateSocialProfileRequest,
)
from app.modules.projects.schemas import ProjectRead
from app.modules.users.models import User

router = APIRouter(tags=["planning"])


@router.post("/api/v1/leads/{lead_id}/planning", response_model=PlanningRead)
def start_planning(
    lead_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanningRead:
    """"Start Planning" — opens (or, the first time, creates) this
    lead's Planning workspace. Cheap and side-effect-free beyond that
    one row, so unlike /analyse this isn't generation-rate-limited."""
    planning = service.start_planning(db, current_user.workspace_id, current_user.id, lead_id)
    if planning is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return planning


@router.get("/api/v1/leads/{lead_id}/planning", response_model=PlanningRead | None)
def get_planning_for_lead(
    lead_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanningRead | None:
    try:
        return service.get_planning_for_lead(db, current_user.workspace_id, lead_id)
    except service.LeadNotFoundError:
        raise HTTPException(status_code=404, detail="Lead not found")


@router.post("/api/v1/planning/{planning_id}/analyse", response_model=PlanningRead)
def analyse_planning(
    planning_id: uuid.UUID,
    body: AnalysePlanningRequest = AnalysePlanningRequest(),
    current_user: User = Depends(enforce_generation_rate_limit),
    db: Session = Depends(get_db),
) -> PlanningRead:
    """"Analyse Website" — the explicit trigger that actually enqueues
    the background audit pipeline. Rate-limited: unlike starting the
    workspace, this is the action that spends LLM calls."""
    try:
        planning = service.run_analysis(
            db, current_user.workspace_id, current_user.id, planning_id, body.website_url
        )
    except service.NoWebsiteUrlError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item not found")
    return planning


@router.post("/api/v1/planning/{planning_id}/review-insights", response_model=PlanningRead)
def run_review_insights(
    planning_id: uuid.UUID,
    current_user: User = Depends(enforce_generation_rate_limit),
    db: Session = Depends(get_db),
) -> PlanningRead:
    """"Run Review Insights" — fetches/refreshes this Lead's Google
    review intelligence and synthesizes it against the workspace's own
    website audit. Rate-limited: calls Google Places and an LLM."""
    planning = service.run_review_insights(db, current_user.workspace_id, current_user.id, planning_id)
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item not found")
    return planning


@router.post("/api/v1/planning/{planning_id}/generate-website-plan", response_model=PlanningRead)
def generate_website_plan(
    planning_id: uuid.UUID,
    current_user: User = Depends(enforce_generation_rate_limit),
    db: Session = Depends(get_db),
) -> PlanningRead:
    """"Generate Website Plan" — New Website Plan mode's core action,
    for a Lead with no website to audit. Rate-limited: calls an LLM."""
    planning = service.generate_website_plan(db, current_user.workspace_id, current_user.id, planning_id)
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item not found")
    return planning


@router.patch("/api/v1/planning/{planning_id}/social-profile", response_model=PlanningRead)
def update_social_profile(
    planning_id: uuid.UUID,
    body: UpdateSocialProfileRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanningRead:
    """Operator-confirmed Instagram/Facebook details. A plain DB write —
    no LLM or network call — so unlike the generation actions above,
    this isn't rate-limited."""
    planning = service.update_social_profile(db, current_user.workspace_id, planning_id, body)
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item not found")
    return planning


# --- Build Brief: Keep / Improve / Add --------------------------------------


@router.post("/api/v1/planning/{planning_id}/recommendations/generate", response_model=PlanningRead)
def generate_recommendations(
    planning_id: uuid.UUID,
    current_user: User = Depends(enforce_generation_rate_limit),
    db: Session = Depends(get_db),
) -> PlanningRead:
    """Build Brief "Keep / Improve / Add". Rate-limited: calls an LLM."""
    planning = service.generate_recommendations(db, current_user.workspace_id, current_user.id, planning_id)
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item not found")
    return planning


@router.post("/api/v1/planning/{planning_id}/recommendations", response_model=PlanningRead)
def add_recommendation(
    planning_id: uuid.UUID,
    body: CreateRecommendationRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanningRead:
    planning = service.add_recommendation(db, current_user.workspace_id, planning_id, body)
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item not found")
    return planning


@router.patch("/api/v1/planning/{planning_id}/recommendations/{recommendation_id}", response_model=PlanningRead)
def update_recommendation(
    planning_id: uuid.UUID,
    recommendation_id: uuid.UUID,
    body: UpdateRecommendationRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanningRead:
    planning = service.update_recommendation(db, current_user.workspace_id, planning_id, recommendation_id, body)
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item or recommendation not found")
    return planning


@router.delete("/api/v1/planning/{planning_id}/recommendations/{recommendation_id}", response_model=PlanningRead)
def delete_recommendation(
    planning_id: uuid.UUID,
    recommendation_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanningRead:
    planning = service.delete_recommendation(db, current_user.workspace_id, planning_id, recommendation_id)
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item or recommendation not found")
    return planning


# --- Build Brief: Proposed Sitemap and Homepage Outline ---------------------


@router.post("/api/v1/planning/{planning_id}/sitemap/generate", response_model=PlanningRead)
def generate_sitemap_proposal(
    planning_id: uuid.UUID,
    current_user: User = Depends(enforce_generation_rate_limit),
    db: Session = Depends(get_db),
) -> PlanningRead:
    """Build Brief "Proposed Sitemap and Homepage Outline". Rate-limited:
    calls an LLM."""
    planning = service.generate_sitemap_proposal(db, current_user.workspace_id, current_user.id, planning_id)
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item not found")
    return planning


@router.post("/api/v1/planning/{planning_id}/sitemap", response_model=PlanningRead)
def add_sitemap_page(
    planning_id: uuid.UUID,
    body: CreateSitemapPageRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanningRead:
    planning = service.add_sitemap_page(db, current_user.workspace_id, planning_id, body)
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item not found")
    return planning


@router.patch("/api/v1/planning/{planning_id}/sitemap/reorder", response_model=PlanningRead)
def reorder_sitemap_pages(
    planning_id: uuid.UUID,
    body: ReorderSitemapPagesRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanningRead:
    planning = service.reorder_sitemap_pages(db, current_user.workspace_id, planning_id, body)
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item not found")
    return planning


@router.patch("/api/v1/planning/{planning_id}/sitemap/{page_id}", response_model=PlanningRead)
def update_sitemap_page(
    planning_id: uuid.UUID,
    page_id: uuid.UUID,
    body: UpdateSitemapPageRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanningRead:
    planning = service.update_sitemap_page(db, current_user.workspace_id, planning_id, page_id, body)
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item or sitemap page not found")
    return planning


@router.delete("/api/v1/planning/{planning_id}/sitemap/{page_id}", response_model=PlanningRead)
def delete_sitemap_page(
    planning_id: uuid.UUID,
    page_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanningRead:
    planning = service.delete_sitemap_page(db, current_user.workspace_id, planning_id, page_id)
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item or sitemap page not found")
    return planning


# --- Build Brief: Visual Direction Choices ----------------------------------


@router.post("/api/v1/planning/{planning_id}/visual-directions/generate", response_model=PlanningRead)
def generate_visual_directions(
    planning_id: uuid.UUID,
    current_user: User = Depends(enforce_generation_rate_limit),
    db: Session = Depends(get_db),
) -> PlanningRead:
    """Build Brief "Visual Direction Choices". Rate-limited: calls an
    LLM (PREMIUM — see agents/planning_visual_directions.py)."""
    planning = service.generate_visual_directions(db, current_user.workspace_id, current_user.id, planning_id)
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item not found")
    return planning


@router.patch("/api/v1/planning/{planning_id}/visual-directions/select", response_model=PlanningRead)
def select_visual_direction(
    planning_id: uuid.UUID,
    body: SelectVisualDirectionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanningRead:
    try:
        planning = service.select_visual_direction(db, current_user.workspace_id, planning_id, body)
    except service.NoVisualDirectionSelectedError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item not found")
    return planning


# --- Build Brief: Assets Checklist ------------------------------------------


@router.post("/api/v1/planning/{planning_id}/assets/refresh", response_model=PlanningRead)
def generate_assets_checklist(
    planning_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanningRead:
    """Seeds/refreshes the Assets Checklist — a plain DB write over
    already-known records, no LLM call, so unlike the generation actions
    above this isn't rate-limited."""
    planning = service.generate_assets_checklist(db, current_user.workspace_id, current_user.id, planning_id)
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item not found")
    return planning


@router.post("/api/v1/planning/{planning_id}/assets", response_model=PlanningRead)
def add_asset(
    planning_id: uuid.UUID,
    body: CreateAssetRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanningRead:
    planning = service.add_asset(db, current_user.workspace_id, planning_id, body)
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item not found")
    return planning


@router.patch("/api/v1/planning/{planning_id}/assets/{asset_id}", response_model=PlanningRead)
def update_asset(
    planning_id: uuid.UUID,
    asset_id: uuid.UUID,
    body: UpdateAssetRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanningRead:
    planning = service.update_asset(db, current_user.workspace_id, planning_id, asset_id, body)
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item or asset not found")
    return planning


# --- Build Brief: compiled preview + approval -------------------------------


@router.get("/api/v1/planning/{planning_id}/build-brief", response_model=BuildBriefRead)
def get_build_brief(
    planning_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BuildBriefRead:
    brief = service.compute_build_brief(db, current_user.workspace_id, planning_id)
    if brief is None:
        raise HTTPException(status_code=404, detail="Planning item not found")
    return brief


@router.post("/api/v1/planning/{planning_id}/build-brief/approve", response_model=BuildBriefRead)
def approve_build_brief(
    planning_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BuildBriefRead:
    brief = service.approve_build_brief(db, current_user.workspace_id, current_user.id, planning_id)
    if brief is None:
        raise HTTPException(status_code=404, detail="Planning item not found")
    return brief


# --- Content Draft -----------------------------------------------------


@router.post("/api/v1/planning/{planning_id}/content-draft/generate", response_model=PlanningRead)
def generate_content_draft(
    planning_id: uuid.UUID,
    current_user: User = Depends(enforce_generation_rate_limit),
    db: Session = Depends(get_db),
) -> PlanningRead:
    """"Generate Content Draft" — job-queued (see JOB_CONTENT_DRAFT_GENERATE);
    rate-limited since it calls a PREMIUM LLM once per planned page."""
    try:
        planning = service.run_content_draft(db, current_user.workspace_id, current_user.id, planning_id)
    except service.NoSitemapPagesError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item not found")
    return planning


@router.patch(
    "/api/v1/planning/{planning_id}/content-draft/pages/{page_id}",
    response_model=PlanningRead,
)
def update_content_page_seo(
    planning_id: uuid.UUID,
    page_id: uuid.UUID,
    body: UpdateContentPageSeoRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanningRead:
    planning = service.update_content_page_seo(
        db, current_user.workspace_id, planning_id, page_id, body.seo_title, body.seo_meta_description
    )
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item or content page not found")
    return planning


@router.patch(
    "/api/v1/planning/{planning_id}/content-draft/pages/{page_id}/sections/{section_id}",
    response_model=PlanningRead,
)
def update_content_section(
    planning_id: uuid.UUID,
    page_id: uuid.UUID,
    section_id: uuid.UUID,
    body: UpdateContentSectionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanningRead:
    planning = service.update_content_section(
        db, current_user.workspace_id, planning_id, page_id, section_id, body.content
    )
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item, content page, or section not found")
    return planning


@router.post(
    "/api/v1/planning/{planning_id}/content-draft/pages/{page_id}/sections/{section_id}/regenerate",
    response_model=RegenerateContentSectionResponse,
)
def regenerate_content_section(
    planning_id: uuid.UUID,
    page_id: uuid.UUID,
    section_id: uuid.UUID,
    current_user: User = Depends(enforce_generation_rate_limit),
    db: Session = Depends(get_db),
) -> RegenerateContentSectionResponse:
    """Replaces an untouched section immediately; returns a preview
    (nothing persisted) for an edited section or one on an approved
    page — see service.regenerate_content_section's own docstring."""
    result = service.regenerate_content_section(db, current_user.workspace_id, planning_id, page_id, section_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Planning item, content page, or section not found")
    return result


@router.post(
    "/api/v1/planning/{planning_id}/content-draft/pages/{page_id}/sections/{section_id}/apply-preview",
    response_model=PlanningRead,
)
def apply_content_section_preview(
    planning_id: uuid.UUID,
    page_id: uuid.UUID,
    section_id: uuid.UUID,
    body: ApplyContentSectionPreviewRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanningRead:
    planning = service.apply_content_section_preview(
        db, current_user.workspace_id, planning_id, page_id, section_id, body.content, body.needs_confirmation_notes
    )
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item, content page, or section not found")
    return planning


@router.post("/api/v1/planning/{planning_id}/content-draft/pages/{page_id}/approve", response_model=PlanningRead)
def approve_content_page(
    planning_id: uuid.UUID,
    page_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanningRead:
    planning = service.approve_content_page(db, current_user.workspace_id, current_user.id, planning_id, page_id)
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item or content page not found")
    return planning


@router.post("/api/v1/planning/{planning_id}/comparable-sites/search", response_model=PlanningRead)
def search_comparable_sites(
    planning_id: uuid.UUID,
    current_user: User = Depends(enforce_generation_rate_limit),
    db: Session = Depends(get_db),
) -> PlanningRead:
    """"Research Comparable Websites" (search step) — one call to the
    same discovery provider adapters Discovery already uses. Rate-
    limited: calls a paid search API, same as a Discovery search."""
    try:
        planning = service.search_comparable_sites(db, current_user.workspace_id, current_user.id, planning_id)
    except ProviderUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item not found")
    return planning


@router.patch("/api/v1/planning/{planning_id}/comparable-sites/{site_id}", response_model=PlanningRead)
def update_comparable_site(
    planning_id: uuid.UUID,
    site_id: uuid.UUID,
    body: UpdateComparableSiteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanningRead:
    """Include/exclude a candidate reference site before analysis."""
    planning = service.update_comparable_site(
        db, current_user.workspace_id, planning_id, site_id, body.included
    )
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item or comparable site not found")
    return planning


@router.post("/api/v1/planning/{planning_id}/comparable-sites/analyse", response_model=PlanningRead)
def analyse_comparable_sites(
    planning_id: uuid.UUID,
    current_user: User = Depends(enforce_generation_rate_limit),
    db: Session = Depends(get_db),
) -> PlanningRead:
    """"Research Comparable Websites" (analyse step) — enqueues the
    background job that fetches each included site's public homepage
    and synthesizes market patterns/opportunities. Rate-limited: this
    is the action that spends LLM calls."""
    try:
        planning = service.run_comparable_analysis(db, current_user.workspace_id, current_user.id, planning_id)
    except service.NoComparableSitesIncludedError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item not found")
    return planning


@router.get("/api/v1/planning", response_model=list[PlanningListItem])
def list_planning(
    include_transferred: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[PlanningListItem]:
    return service.list_planning_workspace(db, current_user.workspace_id, include_transferred=include_transferred)


@router.get("/api/v1/planning/{planning_id}", response_model=PlanningRead)
def get_planning(
    planning_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanningRead:
    planning = service.get_planning(db, current_user.workspace_id, planning_id)
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item not found")
    return planning


@router.patch("/api/v1/planning/{planning_id}", response_model=PlanningRead)
def update_planning(
    planning_id: uuid.UUID,
    body: UpdatePlanningRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanningRead:
    planning = service.update_planning(
        db, current_user.workspace_id, planning_id, body.model_dump(exclude_unset=True)
    )
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item not found")
    return planning


@router.delete("/api/v1/planning/{planning_id}", status_code=204)
def delete_planning(
    planning_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    removed = service.delete_planning(db, current_user.workspace_id, current_user.id, planning_id)
    if removed is None:
        raise HTTPException(status_code=404, detail="Planning item not found")


@router.post("/api/v1/planning/{planning_id}/create-project", response_model=ProjectRead, status_code=201)
def create_project_from_planning(
    planning_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProjectRead:
    try:
        project = service.create_project_from_planning(db, current_user.workspace_id, current_user.id, planning_id)
    except service.NoApprovedBriefError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if project is None:
        raise HTTPException(status_code=404, detail="Planning item not found")
    return project
