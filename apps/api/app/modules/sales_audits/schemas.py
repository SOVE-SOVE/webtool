import uuid
from datetime import datetime

from pydantic import BaseModel

from app.modules.website_audits.schemas import WebsiteAuditRead


def _split(text: str) -> list[str]:
    return [line.strip() for line in text.splitlines() if line.strip()]


class SalesAuditRead(BaseModel):
    id: uuid.UUID
    lead_id: uuid.UUID
    website_audit: WebsiteAuditRead | None

    business_summary: str
    website_strengths: list[str]
    top_problems: list[str]
    why_problems_matter: list[str]
    recommended_improvements: list[str]
    suggested_structure: list[str]
    talking_points: list[str]
    potential_objections: list[str]
    suggested_offer: str

    sources_note: str | None
    flagged_for_review: bool
    review_notes: str | None
    model_used: str
    generated_by_user_id: uuid.UUID | None
    generated_by_user_name: str | None
    generated_at: datetime

    @classmethod
    def from_model(cls, report) -> "SalesAuditRead":
        return cls(
            id=report.id,
            lead_id=report.lead_id,
            website_audit=WebsiteAuditRead.model_validate(report.website_audit)
            if report.website_audit
            else None,
            business_summary=report.business_summary,
            website_strengths=_split(report.website_strengths),
            top_problems=_split(report.top_problems),
            why_problems_matter=_split(report.why_problems_matter),
            recommended_improvements=_split(report.recommended_improvements),
            suggested_structure=_split(report.suggested_structure),
            talking_points=_split(report.talking_points),
            potential_objections=_split(report.potential_objections),
            suggested_offer=report.suggested_offer,
            sources_note=report.sources_note,
            flagged_for_review=report.flagged_for_review,
            review_notes=report.review_notes,
            model_used=report.model_used,
            generated_by_user_id=report.generated_by_user_id,
            generated_by_user_name=report.generated_by_user.name if report.generated_by_user else None,
            generated_at=report.generated_at,
        )
