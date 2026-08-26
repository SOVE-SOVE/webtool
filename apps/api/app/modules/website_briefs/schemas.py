import uuid
from datetime import datetime

from pydantic import BaseModel

from app.modules.website_briefs.models import WebsiteBriefStatus


def _split(text: str) -> list[str]:
    return [line.strip() for line in text.splitlines() if line.strip()]


class GenerateWebsiteBriefRequest(BaseModel):
    """
    Operator-supplied context/overrides at generation time. `creative_direction_id`/
    `sitemap_id` pin which upstream version to draw on; left unset, generation
    resolves the latest approved one (or the most recent if none is approved
    yet) for the project — same convention as GenerateSitemapRequest.
    """

    target_audience: str | None = None
    business_goals: str | None = None
    creative_direction_id: uuid.UUID | None = None
    sitemap_id: uuid.UUID | None = None
    additional_notes: str | None = None


class WebsiteBriefUpdate(BaseModel):
    """
    Partial edit of a generated brief — every section must remain
    editable. Any field left unset is left unchanged. List-shaped fields
    are replaced wholesale, not merged.
    """

    project_summary: str | None = None
    goals: list[str] | None = None
    target_audience: str | None = None
    positioning: str | None = None
    sitemap_summary: list[str] | None = None
    page_purposes: list[str] | None = None
    content_requirements: list[str] | None = None
    cta_strategy: str | None = None
    visual_direction: str | None = None
    functionality: list[str] | None = None
    seo_considerations: list[str] | None = None
    technical_requirements: list[str] | None = None
    confirmed_requirements: list[str] | None = None
    ai_suggestions: list[str] | None = None


class WebsiteBriefRead(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    status: WebsiteBriefStatus

    creative_direction_id: uuid.UUID | None
    sitemap_id: uuid.UUID | None

    project_summary: str
    goals: list[str]
    target_audience: str
    positioning: str
    sitemap_summary: list[str]
    page_purposes: list[str]
    content_requirements: list[str]
    cta_strategy: str
    visual_direction: str
    functionality: list[str]
    seo_considerations: list[str]
    technical_requirements: list[str]

    confirmed_requirements: list[str]
    ai_suggestions: list[str]

    sources_note: str | None
    flagged_for_review: bool
    review_notes: str | None
    model_used: str

    generated_by_user_id: uuid.UUID | None
    generated_by_user_name: str | None
    generated_at: datetime

    edited_by_user_name: str | None
    edited_at: datetime | None

    approved_by_user_name: str | None
    approved_at: datetime | None

    @classmethod
    def from_model(cls, brief) -> "WebsiteBriefRead":
        return cls(
            id=brief.id,
            project_id=brief.project_id,
            status=brief.status,
            creative_direction_id=brief.creative_direction_id,
            sitemap_id=brief.sitemap_id,
            project_summary=brief.project_summary,
            goals=_split(brief.goals),
            target_audience=brief.target_audience,
            positioning=brief.positioning,
            sitemap_summary=_split(brief.sitemap_summary),
            page_purposes=_split(brief.page_purposes),
            content_requirements=_split(brief.content_requirements),
            cta_strategy=brief.cta_strategy,
            visual_direction=brief.visual_direction,
            functionality=_split(brief.functionality),
            seo_considerations=_split(brief.seo_considerations),
            technical_requirements=_split(brief.technical_requirements),
            confirmed_requirements=_split(brief.confirmed_requirements),
            ai_suggestions=_split(brief.ai_suggestions),
            sources_note=brief.sources_note,
            flagged_for_review=brief.flagged_for_review,
            review_notes=brief.review_notes,
            model_used=brief.model_used,
            generated_by_user_id=brief.generated_by_user_id,
            generated_by_user_name=brief.generated_by_user.name if brief.generated_by_user else None,
            generated_at=brief.generated_at,
            edited_by_user_name=brief.edited_by_user.name if brief.edited_by_user else None,
            edited_at=brief.edited_at,
            approved_by_user_name=brief.approved_by_user.name if brief.approved_by_user else None,
            approved_at=brief.approved_at,
        )
