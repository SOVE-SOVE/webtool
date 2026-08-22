import uuid
from datetime import datetime

from pydantic import BaseModel


def _split(text: str | None) -> list[str]:
    if not text:
        return []
    return [line.strip() for line in text.splitlines() if line.strip()]


class BusinessResearchResultRead(BaseModel):
    id: uuid.UUID
    discovered_business_id: uuid.UUID

    official_website_url: str | None
    website_reachable: bool | None
    https: bool | None
    http_status: int | None
    page_title: str | None
    meta_description: str | None
    mobile_viewport_present: bool | None
    contact_cta_present: bool | None
    estimated_site_age: str | None
    appears_template_or_placeholder: bool | None

    technical_issues: list[str]
    social_presence: list[str]
    confirmed_facts: list[str]
    inferred_facts: list[str]
    unavailable_fields: list[str]

    research_error: str | None
    researched_at: datetime

    @classmethod
    def from_model(cls, result) -> "BusinessResearchResultRead":
        return cls(
            id=result.id,
            discovered_business_id=result.discovered_business_id,
            official_website_url=result.official_website_url,
            website_reachable=result.website_reachable,
            https=result.https,
            http_status=result.http_status,
            page_title=result.page_title,
            meta_description=result.meta_description,
            mobile_viewport_present=result.mobile_viewport_present,
            contact_cta_present=result.contact_cta_present,
            estimated_site_age=result.estimated_site_age,
            appears_template_or_placeholder=result.appears_template_or_placeholder,
            technical_issues=_split(result.technical_issues),
            social_presence=_split(result.social_presence),
            confirmed_facts=_split(result.confirmed_facts),
            inferred_facts=_split(result.inferred_facts),
            unavailable_fields=_split(result.unavailable_fields),
            research_error=result.research_error,
            researched_at=result.researched_at,
        )
