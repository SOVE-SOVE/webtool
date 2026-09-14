"""
Planning's Build Brief (docs/05_DECISIONS.md) — "Visual Direction
Choices". Deliberately a separate, lighter agent from
agents/creative_director.py rather than calling it 2-3 times: Creative
Director produces one heavy multi-paragraph direction per call (a full
FACTS/ASSUMPTIONS/9-field brief) at PREMIUM cost — this agent generates
2-3 genuinely distinct, CONCISE options (5 short fields each) in a
single call. Creative Director itself is reused at the point that
actually matters: modules/planning/service.py writes the chosen option
straight into a real CreativeDirectionBrief row at Create Project, so it
goes through that module's own generate/edit/approve/advance_stage flow
exactly like any other project's creative direction.

Comparable-site research may inform high-level pattern language only —
the prompt carries the same "never copy branding/text/imagery" guardrail
agents/planning_comparable_patterns.md already states. A social profile
image, when present, is acknowledged as existing only — never described.
This is a PREMIUM task (AITask.PLANNING_VISUAL_DIRECTIONS): like
Creative Director, it's creative/strategic judgment that directly shapes
what a paying client sees.
"""

from pathlib import Path

from pydantic import BaseModel

from app.agents.base import AgentResult
from app.integrations.ai.router import generate_structured
from app.integrations.ai.tasks import AITask

PROMPT_VERSION = "planning_visual_directions-v1"
_PROMPT_PATH = Path(__file__).parent / "prompts" / "planning_visual_directions.md"


class PlanningVisualDirectionsInput(BaseModel):
    business_name: str
    business_category: str | None = None
    website_objective: str | None = None
    positive_review_themes: list[str] = []
    has_instagram_profile_image: bool = False
    instagram_bio: str | None = None
    comparable_patterns: list[str] = []
    operator_notes: str | None = None


class VisualDirectionOption(BaseModel):
    character: str
    typography: str
    colour_palette: str
    imagery: str
    layout: str


class PlanningVisualDirectionsOutput(BaseModel):
    options: list[VisualDirectionOption] = []


def _load_system_prompt() -> str:
    return _PROMPT_PATH.read_text(encoding="utf-8")


def _build_user_message(input: PlanningVisualDirectionsInput) -> str:
    lines = [
        f"Business name: {input.business_name}",
        f"Business category: {input.business_category or 'not on file'}",
        f"Website objective: {input.website_objective or 'not generated yet'}",
    ]
    if input.positive_review_themes:
        lines.append("Positive review themes (customer language):\n" + "\n".join(f"- {t}" for t in input.positive_review_themes))
    if input.instagram_bio:
        lines.append(f'Instagram bio: "{input.instagram_bio}"')
    if input.has_instagram_profile_image:
        lines.append("A profile image is on file for this business — reference only; do not describe its contents.")
    if input.comparable_patterns:
        lines.append(
            "High-level patterns from public comparable-site research (patterns only, never copy their "
            "branding/text/imagery):\n" + "\n".join(f"- {p}" for p in input.comparable_patterns)
        )
    if input.operator_notes:
        lines.append(f"Operator notes: {input.operator_notes}")
    return "\n".join(lines)


def run(input: PlanningVisualDirectionsInput) -> AgentResult[PlanningVisualDirectionsOutput]:
    schema = PlanningVisualDirectionsOutput.model_json_schema()
    raw = generate_structured(
        task=AITask.PLANNING_VISUAL_DIRECTIONS,
        system=_load_system_prompt(),
        user=_build_user_message(input),
        schema=schema,
        max_tokens=1400,
    )
    output = PlanningVisualDirectionsOutput.model_validate(raw)
    return AgentResult(output=output)
