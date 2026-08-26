import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.projects.models import Project
    from app.modules.users.models import User


class CreativeDirectionStatus(str, enum.Enum):
    """
    DRAFT until the operator reviews/edits it; APPROVED is the explicit
    "continue to website generation" gate per the Creative Director
    feature's review-before-continuing requirement — mirrors
    OutreachStatus's DRAFTED->APPROVED step (modules/outreach/models.py).
    """

    DRAFT = "draft"
    APPROVED = "approved"


class CreativeDirectionBrief(Base):
    """
    A generated Creative Direction — the practical, client-specific
    design direction produced by agents/creative_director.py, meant to
    brief a website designer or the site-generation system before build
    work starts (roadmap M4). One row per generation; a project can
    accumulate several over time, newest reviewed first. Editable in
    place (edited_* columns) rather than versioned, since the point is a
    single reviewed-and-corrected direction to carry forward, not an
    audit trail of every draft.

    Deliberately a separate table from `design_briefs` (which is an
    unused stub — goals/tone/pages — scoped for a plainer brief): this
    is the much richer, structured creative direction the operator asked
    for, not a fill of that stub.
    """

    __tablename__ = "creative_direction_briefs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))

    status: Mapped[CreativeDirectionStatus] = mapped_column(
        Enum(CreativeDirectionStatus, name="creative_direction_status"), default=CreativeDirectionStatus.DRAFT
    )

    # What the operator supplied at generation time (client intake,
    # roadmap M4, doesn't exist yet as a structured source — see
    # agents/creative_director.py). Kept for traceability/re-generation.
    target_audience: Mapped[str | None] = mapped_column(Text)
    business_goals: Mapped[str | None] = mapped_column(Text)
    conversion_goal: Mapped[str | None] = mapped_column(Text)

    # FACTS / RECOMMENDATIONS / ASSUMPTIONS framework required by the
    # Creative Director feature — facts and assumptions are explicit
    # lists; every other field below is inherently a recommendation.
    facts: Mapped[str] = mapped_column(Text)
    assumptions: Mapped[str] = mapped_column(Text)

    creative_concept: Mapped[str] = mapped_column(Text)
    visual_direction: Mapped[str] = mapped_column(Text)
    brand_personality: Mapped[str] = mapped_column(Text)
    colour_direction: Mapped[str] = mapped_column(Text)
    typography_direction: Mapped[str] = mapped_column(Text)
    spacing_system: Mapped[str] = mapped_column(Text, server_default="")
    image_direction: Mapped[str] = mapped_column(Text)
    component_style: Mapped[str] = mapped_column(Text, server_default="")
    layout_direction: Mapped[str] = mapped_column(Text)
    ux_direction: Mapped[str] = mapped_column(Text)
    tone_of_voice: Mapped[str] = mapped_column(Text)
    visual_hierarchy: Mapped[str] = mapped_column(Text)
    cta_strategy: Mapped[str] = mapped_column(Text)
    things_to_avoid: Mapped[str] = mapped_column(Text)
    references_inspiration: Mapped[str] = mapped_column(Text)

    sources_note: Mapped[str | None] = mapped_column(Text)
    flagged_for_review: Mapped[bool] = mapped_column(Boolean, default=False)
    review_notes: Mapped[str | None] = mapped_column(Text)
    model_used: Mapped[str] = mapped_column(String(100))
    prompt_version: Mapped[str] = mapped_column(String(50))

    generated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    edited_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    approved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # One-directional on purpose (no back_populates on Project): keeps
    # this module additive against projects/models.py, which other work
    # is touching concurrently. Query via a join instead of
    # project.creative_direction_briefs.
    project: Mapped["Project"] = relationship(viewonly=True)
    generated_by_user: Mapped["User | None"] = relationship(foreign_keys=[generated_by_user_id])
    edited_by_user: Mapped["User | None"] = relationship(foreign_keys=[edited_by_user_id])
    approved_by_user: Mapped["User | None"] = relationship(foreign_keys=[approved_by_user_id])
