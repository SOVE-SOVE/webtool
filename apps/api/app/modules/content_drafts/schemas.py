import uuid
from datetime import datetime

from pydantic import BaseModel

from app.agents.content_generator import ToneLiteral
from app.modules.content_drafts.models import ContentDraftStatus


class GenerateContentDraftRequest(BaseModel):
    """Operator-supplied context at generation time. Defaults to the
    project's approved sitemap/creative direction (same "approved first,
    fall back to latest" resolution as modules/websites/service.py) unless
    a specific version is named here."""

    tone: ToneLiteral = "professional"
    sitemap_id: uuid.UUID | None = None
    creative_direction_id: uuid.UUID | None = None
    additional_notes: str | None = None


class DraftedServiceItem(BaseModel):
    title: str
    description: str


class DraftedFaqItem(BaseModel):
    question: str
    answer: str


class PageContentDraft(BaseModel):
    """One page's editable content block — the same shape stored in
    ContentDraft.config["pages"] and consumed by
    agents/website_generator.py once approved. Every field is optional:
    only what was honestly draftable (or has since been hand-edited) is
    present."""

    page_id: str
    page_title: str
    seo_title: str | None = None
    meta_description: str | None = None
    hero_heading: str | None = None
    hero_subheading: str | None = None
    body: str | None = None
    services: list[DraftedServiceItem] = []
    faqs: list[DraftedFaqItem] = []
    cta_heading: str | None = None
    cta_body: str | None = None


class ContentPageUpdate(BaseModel):
    """Partial edit of one page's drafted content — the "every section is
    editable" requirement. Any field left unset is left unchanged; a list
    field is replaced wholesale, not merged, same convention as
    CreativeDirectionUpdate."""

    seo_title: str | None = None
    meta_description: str | None = None
    hero_heading: str | None = None
    hero_subheading: str | None = None
    body: str | None = None
    services: list[DraftedServiceItem] | None = None
    faqs: list[DraftedFaqItem] | None = None
    cta_heading: str | None = None
    cta_body: str | None = None


class ApproveContentDraftRequest(BaseModel):
    notes: str | None = None


class ContentDraftRead(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    status: ContentDraftStatus
    tone: str
    sitemap_id: uuid.UUID | None
    creative_direction_id: uuid.UUID | None
    pages: list[PageContentDraft]
    missing_information: list[str]
    rolled_back_from_id: uuid.UUID | None

    sources_note: str | None
    flagged_for_review: bool
    review_notes: str | None
    model_used: str | None

    generated_by_user_id: uuid.UUID | None
    generated_by_user_name: str | None
    generated_at: datetime
    updated_at: datetime

    approved_by_user_name: str | None
    approved_at: datetime | None


class ContentDraftSummary(BaseModel):
    id: uuid.UUID
    status: ContentDraftStatus
    tone: str
    flagged_for_review: bool
    generated_by_user_name: str | None
    generated_at: datetime
    approved: bool
