import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.modules.sitemaps.models import NavPlacement, PageType, SitemapStatus


def _split(text: str | None) -> list[str]:
    return [line.strip() for line in text.splitlines() if line.strip()] if text else []


def _join(items: list[str]) -> str:
    return "\n".join(items)


class GenerateSitemapRequest(BaseModel):
    """
    Triggers generation from the project's brief + creative direction.
    `creative_direction_id` lets the operator pin a specific generation
    when a project has more than one; left unset, the service picks the
    latest APPROVED creative direction for the project, falling back to
    the most recent one of any status, falling back to none.
    """

    creative_direction_id: uuid.UUID | None = None
    additional_notes: str | None = None


class SitemapPageCreate(BaseModel):
    """Operator-added page — the "Add pages" requirement. Only title and
    slug are truly required; everything else can be filled in after."""

    title: str
    slug: str
    page_type: PageType = PageType.CUSTOM
    parent_page_id: uuid.UUID | None = None
    nav_placement: NavPlacement = NavPlacement.PRIMARY_NAV
    purpose: str = ""
    target_audience: str | None = None
    primary_cta: str | None = None
    secondary_cta: str | None = None
    conversion_goal: str | None = None
    seo_intent: str | None = None
    key_sections: list[str] = Field(default_factory=list)
    required_content: list[str] = Field(default_factory=list)
    required_assets: list[str] = Field(default_factory=list)
    required_functionality: list[str] = Field(default_factory=list)
    # Explicit position among its new siblings; omitted appends to the end.
    order_index: int | None = None


class SitemapPageUpdate(BaseModel):
    """
    Partial edit of one page — the "Edit pages" requirement. Only fields
    actually present in the request are applied (see
    model_fields_set usage in service.update_page), so `parent_page_id:
    null` explicitly promotes a page to top-level while omitting the key
    leaves its current parent untouched — same convention as
    ProjectUpdate.assigned_user_id.
    """

    title: str | None = None
    slug: str | None = None
    page_type: PageType | None = None
    parent_page_id: uuid.UUID | None = None
    nav_placement: NavPlacement | None = None
    purpose: str | None = None
    target_audience: str | None = None
    primary_cta: str | None = None
    secondary_cta: str | None = None
    conversion_goal: str | None = None
    seo_intent: str | None = None
    key_sections: list[str] | None = None
    required_content: list[str] | None = None
    required_assets: list[str] | None = None
    required_functionality: list[str] | None = None


class SitemapPageOrder(BaseModel):
    """One entry in a reorder/reparent request."""

    id: uuid.UUID
    order_index: int
    # Omitted (field not sent) leaves the current parent untouched;
    # explicit null promotes the page to top-level.
    parent_page_id: uuid.UUID | None = None


class ReorderSitemapPagesRequest(BaseModel):
    items: list[SitemapPageOrder]


class SitemapPageRead(BaseModel):
    id: uuid.UUID
    sitemap_id: uuid.UUID
    parent_page_id: uuid.UUID | None
    title: str
    slug: str
    page_type: PageType
    nav_placement: NavPlacement
    order_index: int
    purpose: str
    target_audience: str | None
    primary_cta: str | None
    secondary_cta: str | None
    conversion_goal: str | None
    seo_intent: str | None
    key_sections: list[str]
    required_content: list[str]
    required_assets: list[str]
    required_functionality: list[str]
    created_at: datetime
    updated_at: datetime
    children: list["SitemapPageRead"] = Field(default_factory=list)

    @classmethod
    def from_model(cls, page) -> "SitemapPageRead":
        return cls(
            id=page.id,
            sitemap_id=page.sitemap_id,
            parent_page_id=page.parent_page_id,
            title=page.title,
            slug=page.slug,
            page_type=page.page_type,
            nav_placement=page.nav_placement,
            order_index=page.order_index,
            purpose=page.purpose,
            target_audience=page.target_audience,
            primary_cta=page.primary_cta,
            secondary_cta=page.secondary_cta,
            conversion_goal=page.conversion_goal,
            seo_intent=page.seo_intent,
            key_sections=_split(page.key_sections),
            required_content=_split(page.required_content),
            required_assets=_split(page.required_assets),
            required_functionality=_split(page.required_functionality),
            created_at=page.created_at,
            updated_at=page.updated_at,
            children=[],
        )


def build_page_tree(pages: list) -> list[SitemapPageRead]:
    """Flat, order_index-sorted DB rows -> a nested read tree. `pages`
    must already be sorted by order_index (Sitemap.pages' relationship
    order_by guarantees this)."""
    by_id = {page.id: SitemapPageRead.from_model(page) for page in pages}
    roots: list[SitemapPageRead] = []
    for page in pages:
        node = by_id[page.id]
        if page.parent_page_id is not None and page.parent_page_id in by_id:
            by_id[page.parent_page_id].children.append(node)
        else:
            roots.append(node)
    return roots


class SitemapRead(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    status: SitemapStatus
    overview: str | None
    creative_direction_id: uuid.UUID | None
    sources_note: str | None
    flagged_for_review: bool
    review_notes: str | None
    model_used: str | None

    generated_by_user_id: uuid.UUID | None
    generated_by_user_name: str | None
    generated_at: datetime

    approved_by_user_name: str | None
    approved_at: datetime | None
    updated_at: datetime

    pages: list[SitemapPageRead]

    @classmethod
    def from_model(cls, sitemap) -> "SitemapRead":
        return cls(
            id=sitemap.id,
            project_id=sitemap.project_id,
            status=sitemap.status,
            overview=sitemap.overview,
            creative_direction_id=sitemap.creative_direction_id,
            sources_note=sitemap.sources_note,
            flagged_for_review=sitemap.flagged_for_review,
            review_notes=sitemap.review_notes,
            model_used=sitemap.model_used,
            generated_by_user_id=sitemap.generated_by_user_id,
            generated_by_user_name=sitemap.generated_by_user.name if sitemap.generated_by_user else None,
            generated_at=sitemap.generated_at,
            approved_by_user_name=sitemap.approved_by_user.name if sitemap.approved_by_user else None,
            approved_at=sitemap.approved_at,
            updated_at=sitemap.updated_at,
            pages=build_page_tree(sitemap.pages),
        )
