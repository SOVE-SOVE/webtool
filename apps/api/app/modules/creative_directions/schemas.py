import uuid
from datetime import datetime

from pydantic import BaseModel

from app.modules.creative_directions.models import CreativeDirectionStatus


def _split(text: str) -> list[str]:
    return [line.strip() for line in text.splitlines() if line.strip()]


class GenerateCreativeDirectionRequest(BaseModel):
    """
    Operator-supplied context at generation time. Client intake (roadmap
    M4) doesn't exist yet as a structured source of target_audience/
    business_goals — until it does, the operator types them in here, or
    leaves them blank and lets the agent flag the gap as an assumption.
    """

    target_audience: str | None = None
    business_goals: str | None = None
    conversion_goal: str | None = None
    additional_notes: str | None = None


class CreativeDirectionUpdate(BaseModel):
    """
    Partial edit of a generated direction — the review/edit-before-
    continuing step. Any field left unset is left unchanged. List-shaped
    fields are replaced wholesale, not merged.
    """

    facts: list[str] | None = None
    assumptions: list[str] | None = None
    creative_concept: str | None = None
    visual_direction: str | None = None
    brand_personality: list[str] | None = None
    colour_direction: str | None = None
    typography_direction: str | None = None
    spacing_system: str | None = None
    image_direction: str | None = None
    component_style: str | None = None
    layout_direction: str | None = None
    ux_direction: str | None = None
    tone_of_voice: str | None = None
    visual_hierarchy: str | None = None
    cta_strategy: str | None = None
    things_to_avoid: list[str] | None = None
    references_inspiration: list[str] | None = None


class CreativeDirectionRead(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    status: CreativeDirectionStatus

    target_audience: str | None
    business_goals: str | None
    conversion_goal: str | None

    facts: list[str]
    assumptions: list[str]

    creative_concept: str
    visual_direction: str
    brand_personality: list[str]
    colour_direction: str
    typography_direction: str
    spacing_system: str
    image_direction: str
    component_style: str
    layout_direction: str
    ux_direction: str
    tone_of_voice: str
    visual_hierarchy: str
    cta_strategy: str
    things_to_avoid: list[str]
    references_inspiration: list[str]

    sources_note: str | None
    flagged_for_review: bool
    review_notes: str | None
    model_used: str

    generated_by_user_id: uuid.UUID | None
    generated_by_user_name: str | None
    generated_at: datetime

    edited_by_user_name: str | None
    edited_at: datetime | None

    approved_by_user_name: str | None
    approved_at: datetime | None

    @classmethod
    def from_model(cls, brief) -> "CreativeDirectionRead":
        return cls(
            id=brief.id,
            project_id=brief.project_id,
            status=brief.status,
            target_audience=brief.target_audience,
            business_goals=brief.business_goals,
            conversion_goal=brief.conversion_goal,
            facts=_split(brief.facts),
            assumptions=_split(brief.assumptions),
            creative_concept=brief.creative_concept,
            visual_direction=brief.visual_direction,
            brand_personality=_split(brief.brand_personality),
            colour_direction=brief.colour_direction,
            typography_direction=brief.typography_direction,
            spacing_system=brief.spacing_system,
            image_direction=brief.image_direction,
            component_style=brief.component_style,
            layout_direction=brief.layout_direction,
            ux_direction=brief.ux_direction,
            tone_of_voice=brief.tone_of_voice,
            visual_hierarchy=brief.visual_hierarchy,
            cta_strategy=brief.cta_strategy,
            things_to_avoid=_split(brief.things_to_avoid),
            references_inspiration=_split(brief.references_inspiration),
            sources_note=brief.sources_note,
            flagged_for_review=brief.flagged_for_review,
            review_notes=brief.review_notes,
            model_used=brief.model_used,
            generated_by_user_id=brief.generated_by_user_id,
            generated_by_user_name=brief.generated_by_user.name if brief.generated_by_user else None,
            generated_at=brief.generated_at,
            edited_by_user_name=brief.edited_by_user.name if brief.edited_by_user else None,
            edited_at=brief.edited_at,
            approved_by_user_name=brief.approved_by_user.name if brief.approved_by_user else None,
            approved_at=brief.approved_at,
        )
