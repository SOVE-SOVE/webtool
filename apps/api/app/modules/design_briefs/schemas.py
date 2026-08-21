import uuid
from datetime import datetime

from pydantic import BaseModel

from app.modules.design_briefs.models import BriefStatus

# (column name, human-readable label) — the exact list the intake form
# collects, per the operator's brief. Grouped for both the nested Read
# schema and the "what's still missing" report below.
_BUSINESS_FIELDS = [
    ("business_name", "Business name"),
    ("industry", "Industry"),
    ("location", "Location"),
    ("contact_name", "Contact name"),
    ("contact_email", "Contact email"),
    ("contact_phone", "Contact phone"),
    ("business_description", "Business description"),
    ("services_products", "Services / products"),
    ("target_customers", "Target customers"),
    ("business_goals", "Main business goals"),
]
_BRAND_FIELDS = [
    ("brand_name", "Brand name"),
    ("logo_notes", "Logo"),
    ("brand_colours", "Colours"),
    ("brand_fonts", "Fonts"),
    ("brand_guidelines", "Brand guidelines"),
    ("visual_references", "Visual references"),
    ("existing_social_profiles", "Existing social profiles"),
]
_CONTENT_FIELDS = [
    ("about_content", "About / business information"),
    ("services_content", "Services"),
    ("products_content", "Products"),
    ("content_contact_details", "Contact details"),
    ("testimonials", "Testimonials"),
    ("faqs", "FAQs"),
    ("calls_to_action", "Calls to action"),
]
_WEBSITE_FIELDS = [
    ("required_pages", "Required pages"),
    ("required_functionality", "Required functionality"),
    ("existing_website_url", "Existing website"),
    ("domain", "Domain"),
    ("hosting", "Hosting"),
    ("integrations", "Integrations"),
]
_ASSETS_FIELDS = [
    ("logo_assets", "Logos"),
    ("image_assets", "Images"),
    ("video_assets", "Videos"),
    ("document_assets", "Documents"),
    ("existing_copy_assets", "Existing copy"),
]

# List-shaped fields — stored newline-separated, read back as list[str].
# Everything else in the field lists above is a single free-text value.
_LIST_FIELDS = {
    "brand_colours",
    "brand_fonts",
    "visual_references",
    "existing_social_profiles",
    "testimonials",
    "faqs",
    "calls_to_action",
    "required_pages",
    "required_functionality",
    "integrations",
    "logo_assets",
    "image_assets",
    "video_assets",
    "document_assets",
    "existing_copy_assets",
}

_ALL_SECTIONS = [
    ("business", "Business", _BUSINESS_FIELDS),
    ("brand", "Brand", _BRAND_FIELDS),
    ("content", "Content", _CONTENT_FIELDS),
    ("website", "Website", _WEBSITE_FIELDS),
    ("assets", "Assets", _ASSETS_FIELDS),
]


def _split(text: str | None) -> list[str]:
    return [line.strip() for line in text.splitlines() if line.strip()] if text else []


def _is_empty(value: str | None) -> bool:
    return value is None or value.strip() == ""


class BriefBusinessCreate(BaseModel):
    business_name: str | None = None
    industry: str | None = None
    location: str | None = None
    contact_name: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    business_description: str | None = None
    services_products: str | None = None
    target_customers: str | None = None
    business_goals: str | None = None


class BriefBrandCreate(BaseModel):
    brand_name: str | None = None
    logo_notes: str | None = None
    brand_colours: str | None = None
    brand_fonts: str | None = None
    brand_guidelines: str | None = None
    visual_references: str | None = None
    existing_social_profiles: str | None = None


class BriefContentCreate(BaseModel):
    about_content: str | None = None
    services_content: str | None = None
    products_content: str | None = None
    content_contact_details: str | None = None
    testimonials: str | None = None
    faqs: str | None = None
    calls_to_action: str | None = None


class BriefWebsiteCreate(BaseModel):
    required_pages: str | None = None
    required_functionality: str | None = None
    existing_website_url: str | None = None
    domain: str | None = None
    hosting: str | None = None
    integrations: str | None = None


class BriefAssetsCreate(BaseModel):
    logo_assets: str | None = None
    image_assets: str | None = None
    video_assets: str | None = None
    document_assets: str | None = None
    existing_copy_assets: str | None = None


class BriefUpdate(
    BriefBusinessCreate, BriefBrandCreate, BriefContentCreate, BriefWebsiteCreate, BriefAssetsCreate
):
    """
    Flat partial update — every intake field, all optional. Only fields
    present in the request body are applied (see model_fields_set usage
    in service.update_brief), so omitting a field leaves it untouched
    and sending "" explicitly clears it back to missing.
    """


class BriefIntakeStart(BriefUpdate):
    """Same shape as BriefUpdate — the intake form can be filled in as
    much or as little as known when the project is first created."""

    project_name: str | None = None
    # Opt-in to a genuinely additional project for a client who already
    # has an unfinished one; without it, starting intake again returns
    # the existing project's brief rather than duplicating the project.
    force_new: bool = False


class BriefSection(BaseModel):
    label: str
    fields: dict[str, str | list[str] | None]
    missing: list[str]


class BriefRead(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    status: BriefStatus
    approved_at: datetime | None
    approved_by_user_name: str | None

    business: BriefSection
    brand: BriefSection
    content: BriefSection
    website: BriefSection
    assets: BriefSection

    # Flat "Section > Label" list of every still-empty field, across all
    # sections — the single place to check "what's missing". Never
    # fabricated: a field only leaves this list once the operator (or a
    # future research/copy agent, per docs/04_ROADMAP.md M4) actually
    # supplies a value.
    missing_fields: list[str]

    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_model(cls, brief) -> "BriefRead":
        sections: dict[str, BriefSection] = {}
        all_missing: list[str] = []
        for key, label, fields in _ALL_SECTIONS:
            section_fields: dict[str, str | list[str] | None] = {}
            section_missing: list[str] = []
            for column, field_label in fields:
                raw = getattr(brief, column)
                if column in _LIST_FIELDS:
                    value: str | list[str] | None = _split(raw)
                    empty = len(value) == 0
                else:
                    value = raw
                    empty = _is_empty(raw)
                section_fields[column] = value
                if empty:
                    section_missing.append(field_label)
                    all_missing.append(f"{label} > {field_label}")
            sections[key] = BriefSection(label=label, fields=section_fields, missing=section_missing)

        return cls(
            id=brief.id,
            project_id=brief.project_id,
            status=brief.status,
            approved_at=brief.approved_at,
            approved_by_user_name=brief.approved_by_user.name if brief.approved_by_user else None,
            business=sections["business"],
            brand=sections["brand"],
            content=sections["content"],
            website=sections["website"],
            assets=sections["assets"],
            missing_fields=all_missing,
            created_at=brief.created_at,
            updated_at=brief.updated_at,
        )
