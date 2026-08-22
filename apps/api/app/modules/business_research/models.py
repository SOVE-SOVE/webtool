import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.discovery.models import DiscoveredBusiness


class BusinessResearchResult(Base):
    """
    Website/public-presence research for one `DiscoveredBusiness` —
    docs/04_ROADMAP.md Lead Intelligence stage 2. A business can
    accumulate several of these over time (re-research), newest first,
    same convention as `SalesAuditReport`.

    Every finding is bucketed into exactly one of `confirmed_facts`
    (directly observed — e.g. fetched the page, saw the HTTP status),
    `inferred_facts` (a reasonable read on ambiguous evidence — e.g.
    "no copyright year found, page structure suggests an older template"),
    or `unavailable_fields` (genuinely couldn't be determined) rather
    than presenting a guess as a measured fact. Newline-separated text,
    same convention as SalesAuditReport's list-shaped sections — no JSON
    columns for content a human reads as prose.
    """

    __tablename__ = "business_research_results"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    discovered_business_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("discovered_businesses.id", ondelete="CASCADE")
    )

    official_website_url: Mapped[str | None] = mapped_column(String(500))
    website_reachable: Mapped[bool | None] = mapped_column(Boolean)
    https: Mapped[bool | None] = mapped_column(Boolean)
    http_status: Mapped[int | None] = mapped_column(Integer)
    page_title: Mapped[str | None] = mapped_column(String(500))
    meta_description: Mapped[str | None] = mapped_column(Text)
    mobile_viewport_present: Mapped[bool | None] = mapped_column(Boolean)
    contact_cta_present: Mapped[bool | None] = mapped_column(Boolean)
    # Real, measured navigation timing (like website_audits.load_time_ms)
    # — never a fabricated Lighthouse-style score, per that column's own
    # comment on why page_speed_score there is deliberately left unused.
    load_time_ms: Mapped[int | None] = mapped_column(Integer)
    # A description, not a number — e.g. "likely 5+ years (copyright
    # year 2019 found in footer)". Never a fabricated exact age.
    estimated_site_age: Mapped[str | None] = mapped_column(String(255))
    appears_template_or_placeholder: Mapped[bool | None] = mapped_column(Boolean)

    technical_issues: Mapped[str | None] = mapped_column(Text)
    social_presence: Mapped[str | None] = mapped_column(Text)
    confirmed_facts: Mapped[str | None] = mapped_column(Text)
    inferred_facts: Mapped[str | None] = mapped_column(Text)
    unavailable_fields: Mapped[str | None] = mapped_column(Text)

    research_error: Mapped[str | None] = mapped_column(Text)
    researched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    discovered_business: Mapped["DiscoveredBusiness"] = relationship(back_populates="research_results")
