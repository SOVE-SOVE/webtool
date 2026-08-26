import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, Boolean, DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.deployments.models import Deployment
    from app.modules.projects.models import Project
    from app.modules.qa_reports.models import QaReport
    from app.modules.users.models import User


class WebsiteStatus(str, enum.Enum):
    DRAFT = "draft"
    LIVE = "live"


class WebsiteWorkflowStatus(str, enum.Enum):
    """
    Phase 6 Task 3's formal approval workflow — a single, explicit
    lifecycle for one website *version*, layered on top of the existing
    fine-grained boolean checkpoints (`approved`, `client_approved`,
    QaReport.human_approved, ...) rather than replacing them. Legal
    transitions are enforced in modules/websites/service.py's
    ALLOWED_TRANSITIONS, never left to the caller to get right:

        DRAFT -> INTERNAL_REVIEW
        INTERNAL_REVIEW -> CLIENT_REVIEW | CHANGES_REQUESTED | DRAFT
        CLIENT_REVIEW -> APPROVED | CHANGES_REQUESTED
        CHANGES_REQUESTED -> DRAFT | INTERNAL_REVIEW
        APPROVED -> READY_TO_DEPLOY | CHANGES_REQUESTED
        READY_TO_DEPLOY -> DEPLOYED | CHANGES_REQUESTED
        DEPLOYED -> (terminal — a new version starts its own DRAFT)

    `modules/deployments/service.py` refuses to create *or* execute a
    deployment unless the version is currently READY_TO_DEPLOY, checked
    fresh at both points — "require explicit approval before deployment"
    and "prevent accidental deployment of unapproved versions" enforced
    at the data layer, not just documented as a rule. Editing a
    section's content on a version that has progressed past DRAFT resets
    it back to DRAFT (see `update_section`) — same "edit reverts
    approval" contract the boolean checkpoints already have, extended to
    this state.
    """

    DRAFT = "draft"
    INTERNAL_REVIEW = "internal_review"
    CLIENT_REVIEW = "client_review"
    CHANGES_REQUESTED = "changes_requested"
    APPROVED = "approved"
    READY_TO_DEPLOY = "ready_to_deploy"
    DEPLOYED = "deployed"


class Website(Base):
    """
    A generated website — one row per generation (roadmap M5), same
    "newest reviewed first" convention as CreativeDirectionBrief/
    Sitemap: a project can accumulate several over time as the brief/
    sitemap/creative direction change or a section gets regenerated, and
    older rows stay queryable so a prior version can be reviewed or
    diffed against. `config` holds the full assembled site
    (`{navigation, footer, pages: [...]}` — see
    agents/website_generator.py's WebsiteGeneratorOutput) as JSON, the
    same section-config shape `packages/site-templates` renders.

    Each section within `config` carries its own `id` and `approved`
    flag — approval and small content edits (modules/websites/service.py)
    mutate the latest row's `config` in place, same as
    CreativeDirectionBrief's edited_* columns; only a full or
    single-section *regeneration* creates a new row.
    """

    __tablename__ = "websites"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    template_slug: Mapped[str | None] = mapped_column(String(120))
    config: Mapped[dict | None] = mapped_column(JSON)
    status: Mapped[WebsiteStatus] = mapped_column(Enum(WebsiteStatus, name="website_status"), default=WebsiteStatus.DRAFT)
    workflow_status: Mapped[WebsiteWorkflowStatus] = mapped_column(
        Enum(WebsiteWorkflowStatus, name="website_workflow_status"), default=WebsiteWorkflowStatus.DRAFT
    )

    anti_slop_score: Mapped[int | None] = mapped_column(Integer)
    flagged_for_review: Mapped[bool] = mapped_column(Boolean, default=False)
    sources_note: Mapped[str | None] = mapped_column(Text)

    generated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Approval checkpoint 4 ("Generated website", docs/05_DECISIONS.md's
    # human-approval-workflow entry) — the operator's own sign-off that
    # this version's content/design is good, distinct from a section's
    # own `approved` flag inside `config` (that's fine-grained content
    # review; this is the whole-version gate later checkpoints require).
    approved: Mapped[bool] = mapped_column(Boolean, default=False)
    approved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approval_notes: Mapped[str | None] = mapped_column(Text)

    # Approval checkpoint 6 ("Client review") — recorded by an operator
    # on the client's behalf (there's no client login in this app; see
    # docs/03_AGENT_RULES.md's "Client approval communication" note),
    # so `client_approved_by_user_id` is still an internal User, not the
    # client themself.
    client_approved: Mapped[bool] = mapped_column(Boolean, default=False)
    client_approved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    client_approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    client_approval_notes: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    project: Mapped["Project"] = relationship(back_populates="websites")
    generated_by_user: Mapped["User | None"] = relationship(foreign_keys=[generated_by_user_id])
    approved_by_user: Mapped["User | None"] = relationship(foreign_keys=[approved_by_user_id])
    client_approved_by_user: Mapped["User | None"] = relationship(foreign_keys=[client_approved_by_user_id])
    qa_reports: Mapped[list["QaReport"]] = relationship(back_populates="website")
    deployments: Mapped[list["Deployment"]] = relationship(back_populates="website")
    workflow_transitions: Mapped[list["WebsiteWorkflowTransition"]] = relationship(
        back_populates="website", order_by="WebsiteWorkflowTransition.created_at"
    )


class WebsiteWorkflowTransition(Base):
    """
    Append-only history of every workflow_status change for one website
    version — "store approval history," never overwritten or deleted.
    `actor_user_id` is null for a system/client-triggered transition
    (an edit resetting the version to DRAFT, or a client APPROVAL/
    REJECTION/CHANGE_REQUEST feedback item driving CLIENT_REVIEW ->
    APPROVED/CHANGES_REQUESTED via modules/website_feedback/service.py)
    — `actor_label` carries a human-readable description of who/what
    triggered it either way, since there's no client login to attribute
    to a User row.
    """

    __tablename__ = "website_workflow_transitions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    website_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("websites.id", ondelete="CASCADE"))
    from_status: Mapped[WebsiteWorkflowStatus] = mapped_column(Enum(WebsiteWorkflowStatus, name="website_workflow_status"))
    to_status: Mapped[WebsiteWorkflowStatus] = mapped_column(Enum(WebsiteWorkflowStatus, name="website_workflow_status"))
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    actor_label: Mapped[str | None] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    website: Mapped["Website"] = relationship(back_populates="workflow_transitions")
    actor_user: Mapped["User | None"] = relationship()
