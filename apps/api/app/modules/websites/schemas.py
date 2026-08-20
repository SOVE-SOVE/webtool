import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.modules.websites.models import WebsiteStatus


class GenerateWebsiteRequest(BaseModel):
    """
    Which approved sources to build from. Left unset, generation uses
    the project's approved sitemap/creative direction (falling back to
    the latest of each if nothing is approved yet, same convention as
    agents/sitemap.py's creative_direction_id resolution) — an explicit
    id only matters when picking an older version on purpose.
    """

    sitemap_id: uuid.UUID | None = None
    creative_direction_id: uuid.UUID | None = None
    # When True, every section is rebuilt fresh even if the prior
    # version had approved sections. Default False: a full regeneration
    # still carries forward anything the operator already approved,
    # per "allow regeneration... without unnecessarily destroying
    # approved sections."
    force_regenerate_all: bool = False


class SectionRead(BaseModel):
    id: str
    type: str
    config: dict
    approved: bool


class PageSeoRead(BaseModel):
    title: str
    meta_description: str | None


class PageRead(BaseModel):
    sitemap_page_id: str
    name: str
    slug: str
    page_type: str
    seo: PageSeoRead
    sections: list[SectionRead]


class QualityIssueRead(BaseModel):
    category: str
    rule: str
    severity: Literal["high", "medium", "low"]
    message: str
    location: str | None


class WebsiteRead(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    status: WebsiteStatus

    navigation: SectionRead
    footer: SectionRead
    pages: list[PageRead]

    missing_information: list[str]
    anti_slop_score: int
    anti_slop_passed: bool
    anti_slop_issues: list[QualityIssueRead]
    flagged_for_review: bool
    sources_note: str | None

    generated_by_user_id: uuid.UUID | None
    generated_by_user_name: str | None
    generated_at: datetime
    updated_at: datetime


class WebsiteSummary(BaseModel):
    """Lightweight row for the version-history list — no section detail."""

    id: uuid.UUID
    status: WebsiteStatus
    anti_slop_score: int | None
    flagged_for_review: bool
    generated_by_user_name: str | None
    generated_at: datetime


class SectionUpdate(BaseModel):
    """
    Direct edit of one section's content — the "editable output, not a
    locked mockup" requirement. `config` is shallow-merged into the
    existing section config (only the keys provided change), never
    replaced wholesale, so a small copy fix doesn't require resending
    every field. Mutates the version in place; does not create a new
    row (see modules/websites/models.py's Website docstring).
    """

    config: dict | None = None
    approved: bool | None = None
