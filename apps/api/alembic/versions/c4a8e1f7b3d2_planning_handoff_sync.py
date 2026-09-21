"""planning: keep the handed-off Project in sync with later Build Brief changes

The approved Build Brief used to be frozen once a Project consumed it, so
later Planning edits could never reach the Project. Re-approving now pushes
them (see modules/planning/handoff_sync.py); these columns record which
Project rows the handoff created, the last value handed over per field (the
base of the merge), and the last sync's flagged conflicts.

Existing handoffs are backfilled where the seeded rows are identifiable: the
Planning-created creative direction by its `model_used` marker, and the
seeded sitemap by its shape (no overview / model / sources note — every other
way a sitemap is created sets at least one). `handoff_baseline` stays NULL
for them and is rebuilt from the frozen snapshot at the first re-approval.

Revision ID: c4a8e1f7b3d2
Revises: b7e4d2a91c35
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "c4a8e1f7b3d2"
down_revision = "b7e4d2a91c35"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "lead_planning_approved_briefs",
        sa.Column("seeded_sitemap_id", sa.UUID(), nullable=True),
    )
    op.add_column(
        "lead_planning_approved_briefs",
        sa.Column("seeded_creative_direction_id", sa.UUID(), nullable=True),
    )
    op.add_column(
        "lead_planning_approved_briefs",
        sa.Column("handoff_baseline", postgresql.JSON(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "lead_planning_approved_briefs",
        sa.Column("sync_conflicts", postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default="[]"),
    )
    op.create_foreign_key(
        "fk_approved_briefs_seeded_sitemap",
        "lead_planning_approved_briefs",
        "sitemaps",
        ["seeded_sitemap_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_approved_briefs_seeded_creative_direction",
        "lead_planning_approved_briefs",
        "creative_direction_briefs",
        ["seeded_creative_direction_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.execute(
        """
        UPDATE lead_planning_approved_briefs ab
        SET seeded_creative_direction_id = (
            SELECT cd.id FROM creative_direction_briefs cd
            WHERE cd.project_id = ab.project_id AND cd.model_used = 'planning_build_brief'
            ORDER BY cd.generated_at LIMIT 1
        )
        WHERE ab.project_id IS NOT NULL
        """
    )
    op.execute(
        """
        UPDATE lead_planning_approved_briefs ab
        SET seeded_sitemap_id = (
            SELECT s.id FROM sitemaps s
            WHERE s.project_id = ab.project_id
              AND s.overview IS NULL AND s.model_used IS NULL AND s.sources_note IS NULL
            ORDER BY s.generated_at LIMIT 1
        )
        WHERE ab.project_id IS NOT NULL AND json_array_length(ab.sitemap_snapshot) > 0
        """
    )


def downgrade() -> None:
    op.drop_constraint("fk_approved_briefs_seeded_creative_direction", "lead_planning_approved_briefs", type_="foreignkey")
    op.drop_constraint("fk_approved_briefs_seeded_sitemap", "lead_planning_approved_briefs", type_="foreignkey")
    op.drop_column("lead_planning_approved_briefs", "sync_conflicts")
    op.drop_column("lead_planning_approved_briefs", "handoff_baseline")
    op.drop_column("lead_planning_approved_briefs", "seeded_creative_direction_id")
    op.drop_column("lead_planning_approved_briefs", "seeded_sitemap_id")
