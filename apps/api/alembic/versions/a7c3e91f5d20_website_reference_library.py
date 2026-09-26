"""website reference library (shared references + plan attachments)

Revision ID: a7c3e91f5d20
Revises: 58b5772b1735
Create Date: 2026-09-26
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "a7c3e91f5d20"
down_revision = "58b5772b1735"
branch_labels = None
depends_on = None

capture_status = postgresql.ENUM("PENDING", "CAPTURED", "FAILED", name="reference_capture_status", create_type=False)


def upgrade() -> None:
    capture_status.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "website_references",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("workspace_id", sa.UUID(), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("url", sa.String(length=2048), nullable=False),
        sa.Column("normalized_url", sa.String(length=2048), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("capture_status", capture_status, nullable=False),
        sa.Column("capture_error", sa.Text(), nullable=True),
        sa.Column("screenshot_base64", sa.Text(), nullable=True),
        sa.Column("screenshot_captured_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("workspace_id", "normalized_url", name="uq_website_reference_workspace_url"),
    )
    op.create_index("ix_website_references_workspace_id", "website_references", ["workspace_id"])
    op.create_table(
        "lead_planning_references",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "lead_planning_id", sa.UUID(), sa.ForeignKey("lead_planning.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "reference_id", sa.UUID(), sa.ForeignKey("website_references.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.Column("direction", sa.Text(), nullable=True),
        sa.Column("liked_aspects", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("lead_planning_id", "reference_id", name="uq_lead_planning_reference"),
    )
    op.create_index("ix_lead_planning_references_lead_planning_id", "lead_planning_references", ["lead_planning_id"])
    op.create_index("ix_lead_planning_references_reference_id", "lead_planning_references", ["reference_id"])


def downgrade() -> None:
    op.drop_index("ix_lead_planning_references_reference_id", table_name="lead_planning_references")
    op.drop_index("ix_lead_planning_references_lead_planning_id", table_name="lead_planning_references")
    op.drop_table("lead_planning_references")
    op.drop_index("ix_website_references_workspace_id", table_name="website_references")
    op.drop_table("website_references")
    capture_status.drop(op.get_bind(), checkfirst=True)
