import uuid
from datetime import datetime

from pydantic import BaseModel

from app.modules.previews.models import PreviewAudience


class PreviewLinkCreate(BaseModel):
    audience: PreviewAudience = PreviewAudience.CLIENT
    label: str | None = None
    # Days from now until the link stops working — None means it never
    # expires (an operator may want a standing internal link). A
    # client-facing link should generally set one; this default (14)
    # matches the session cookie's own lifetime rather than inventing a
    # new number.
    expires_in_days: int | None = 14


class PreviewLinkRead(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    audience: PreviewAudience
    label: str | None
    # Only ever populated on the create response — the raw token isn't
    # recoverable afterward (only its hash is stored), same contract as
    # an API key.
    url: str | None = None
    token_suffix: str
    active: bool
    revoked: bool
    expired: bool
    expires_at: datetime | None
    last_accessed_at: datetime | None
    access_count: int
    created_by_user_name: str | None
    created_at: datetime


class PreviewVersionSummary(BaseModel):
    id: uuid.UUID
    label: str
    approved: bool
    client_approved: bool
    generated_at: datetime


class PublicPreviewSection(BaseModel):
    id: str
    type: str
    config: dict


class PublicPreviewPage(BaseModel):
    slug: str
    name: str
    sections: list[PublicPreviewSection]


class PublicPreviewRead(BaseModel):
    """The shape a token holder (client or internal viewer, no login)
    actually sees — deliberately narrower than WebsiteRead: no internal
    user names, quality scores, or approval notes, just the renderable
    site plus enough version metadata for the "version selection"
    requirement."""

    project_name: str
    audience: PreviewAudience
    website_id: uuid.UUID
    approved: bool
    client_approved: bool
    navigation: PublicPreviewSection
    footer: PublicPreviewSection
    pages: list[PublicPreviewPage]
    versions: list[PreviewVersionSummary]
