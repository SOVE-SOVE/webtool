import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.integrations.discovery.base import WebsiteStatus

if TYPE_CHECKING:
    from app.modules.businesses.models import Business
    from app.modules.business_research.models import BusinessResearchResult
    from app.modules.leads.models import Lead
    from app.modules.opportunity_scoring.models import OpportunityScoreResult
    from app.modules.users.models import User
    from app.modules.website_quality.models import WebsiteQualityAudit
    from app.modules.workspaces.models import Workspace


class DiscoverySearchStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class DiscoveredBusinessStatus(str, enum.Enum):
    """
    Lifecycle of one discovered candidate, independent of CRM `LeadStatus`
    — this is the pre-CRM review pipeline (docs/04_ROADMAP.md M2 "Lead
    Intelligence"): discover -> research -> audit -> score -> human
    review -> import. A row never becomes a Lead directly; IMPORTED means
    `imported_lead_id` is set and the CRM's own LeadStatus takes over
    from there.
    """

    NEW = "new"
    RESEARCHED = "researched"
    AUDITED = "audited"
    SCORED = "scored"
    APPROVED = "approved"
    REJECTED = "rejected"
    ARCHIVED = "archived"
    IMPORTED = "imported"


class OpportunityScoreCategory(str, enum.Enum):
    HOT = "hot"
    WARM = "warm"
    COLD = "cold"
    REVIEW = "review"


class DiscoverySearch(Base):
    """
    An operator-defined business-discovery request: the criteria plus the
    run's own status/result count. One row per search, independent of
    which provider actually served it (`provider`) — see
    app/integrations/discovery/ (added in the business-discovery
    capability, not yet built here) for the adapter that fills `results`.
    """

    __tablename__ = "discovery_searches"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    # Criteria — every field optional; a search needs at least one
    # non-empty criterion (enforced in the service layer, not here), but
    # which one is free per docs/04_ROADMAP.md's "location, industry,
    # business type, keywords" example ("plumbing businesses on the Gold
    # Coast" only sets industry + location).
    query_label: Mapped[str | None] = mapped_column(String(255))
    location: Mapped[str | None] = mapped_column(String(255))
    industry: Mapped[str | None] = mapped_column(String(120))
    business_type: Mapped[str | None] = mapped_column(String(120))
    keywords: Mapped[str | None] = mapped_column(String(500))
    min_score: Mapped[int | None] = mapped_column(Integer)
    max_score: Mapped[int | None] = mapped_column(Integer)
    # None = don't care either way; True/False = filter for/against.
    has_website: Mapped[bool | None] = mapped_column(Boolean)
    website_outdated: Mapped[bool | None] = mapped_column(Boolean)

    provider: Mapped[str] = mapped_column(String(50))
    status: Mapped[DiscoverySearchStatus] = mapped_column(
        Enum(DiscoverySearchStatus, name="discovery_search_status"), default=DiscoverySearchStatus.PENDING
    )
    result_count: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text)

    # Pagination bookkeeping. `next_offset` is the provider page offset a
    # "load more" would fetch next; `has_more` is whether the last page
    # the provider served said further results exist. One search grows in
    # place as more pages are pulled — see modules/discovery/service.py.
    next_offset: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    has_more: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    workspace: Mapped["Workspace"] = relationship()
    created_by_user: Mapped["User | None"] = relationship()
    results: Mapped[list["DiscoveredBusiness"]] = relationship(
        back_populates="discovery_search", foreign_keys="DiscoveredBusiness.discovery_search_id"
    )


class DiscoveredBusiness(Base):
    """
    One normalized candidate business surfaced by a `DiscoverySearch` —
    the "reviewable results list" from docs/04_ROADMAP.md's Lead
    Intelligence pipeline. Deliberately a separate table from
    `businesses`, not a row in it: nothing here is CRM data until a human
    reviews and imports it (`imported_lead_id`), per the explicit
    "do not automatically import every discovered business" requirement.
    """

    __tablename__ = "discovered_businesses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    discovery_search_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("discovery_searches.id", ondelete="CASCADE")
    )

    name: Mapped[str] = mapped_column(String(255))
    industry: Mapped[str | None] = mapped_column(String(120))
    business_type: Mapped[str | None] = mapped_column(String(120))
    website_url: Mapped[str | None] = mapped_column(String(500))
    # Confirmed website presence/absence — a business with no website is
    # still a valid lead, so this is a tri-state (found/none/unknown),
    # not "is website_url null". See integrations/discovery/base.py.
    website_status: Mapped[WebsiteStatus] = mapped_column(
        Enum(WebsiteStatus, name="discovered_business_website_status"),
        default=WebsiteStatus.UNKNOWN,
        server_default=WebsiteStatus.UNKNOWN.name,
        nullable=False,
    )
    phone: Mapped[str | None] = mapped_column(String(50))
    email: Mapped[str | None] = mapped_column(String(255))
    address: Mapped[str | None] = mapped_column(String(500))
    suburb: Mapped[str | None] = mapped_column(String(120))
    state: Mapped[str | None] = mapped_column(String(10))
    postcode: Mapped[str | None] = mapped_column(String(10))
    country: Mapped[str | None] = mapped_column(String(80))
    # A specific provider-assigned category (places API taxonomy, or a
    # schema.org LocalBusiness subtype) — finer than `industry`.
    business_category: Mapped[str | None] = mapped_column(String(120))
    # Map location — only ever a value a source actually gave us (a
    # places provider's coordinates, or GeoCoordinates published in a
    # site's own schema.org markup). Never inferred/geocoded from a name
    # or a city, so a business with no reliable location simply has no
    # pin. Both set together or both null.
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    # Newline-separated, same convention as businesses.social_links.
    social_links: Mapped[str | None] = mapped_column(Text)

    # Source tracking — which provider found this, what it searched for,
    # and the provider's own id/url for the result (when it has one),
    # so a later search that resurfaces the same listing can be matched
    # back to it instead of creating a second candidate row.
    source_provider: Mapped[str] = mapped_column(String(50))
    source_query: Mapped[str | None] = mapped_column(String(500))
    source_external_id: Mapped[str | None] = mapped_column(String(500))
    # Normalized name+location, computed at creation — see
    # app/modules/discovery/dedup.py — indexed for fast duplicate lookup.
    dedup_key: Mapped[str] = mapped_column(String(500), index=True)

    duplicate_of_business_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("businesses.id", ondelete="SET NULL")
    )
    duplicate_of_discovered_business_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("discovered_businesses.id", ondelete="SET NULL")
    )

    status: Mapped[DiscoveredBusinessStatus] = mapped_column(
        Enum(DiscoveredBusinessStatus, name="discovered_business_status"), default=DiscoveredBusinessStatus.NEW
    )
    # Cached from the latest OpportunityScoreResult, so the results list
    # can filter/sort by score without joining the full scoring history
    # every time — same "denormalized read-model" reasoning as
    # leads.score. The scoring engine (not built in this pass) is the
    # only writer.
    opportunity_score: Mapped[int | None] = mapped_column(Integer)
    score_category: Mapped[OpportunityScoreCategory | None] = mapped_column(
        Enum(OpportunityScoreCategory, name="opportunity_score_category")
    )

    reviewed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_notes: Mapped[str | None] = mapped_column(Text)

    # Traceability once a human imports this into the CRM — same pattern
    # as projects.source_lead_id. Set exactly once; a row whose status is
    # IMPORTED always has this populated.
    imported_lead_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("leads.id", ondelete="SET NULL"))

    discovered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    discovery_search: Mapped["DiscoverySearch"] = relationship(
        back_populates="results", foreign_keys=[discovery_search_id]
    )
    duplicate_of_business: Mapped["Business | None"] = relationship(foreign_keys=[duplicate_of_business_id])
    duplicate_of_discovered_business: Mapped["DiscoveredBusiness | None"] = relationship(
        remote_side=[id], foreign_keys=[duplicate_of_discovered_business_id]
    )
    reviewed_by_user: Mapped["User | None"] = relationship(foreign_keys=[reviewed_by_user_id])
    imported_lead: Mapped["Lead | None"] = relationship(foreign_keys=[imported_lead_id])
    research_results: Mapped[list["BusinessResearchResult"]] = relationship(
        back_populates="discovered_business", order_by="BusinessResearchResult.researched_at.desc()"
    )
    quality_audits: Mapped[list["WebsiteQualityAudit"]] = relationship(
        back_populates="discovered_business", order_by="WebsiteQualityAudit.audited_at.desc()"
    )
    score_results: Mapped[list["OpportunityScoreResult"]] = relationship(
        back_populates="discovered_business", order_by="OpportunityScoreResult.scored_at.desc()"
    )
