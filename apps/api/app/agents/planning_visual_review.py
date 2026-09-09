"""
Planning's visual/usability review role — the one step in Planning that
needs a judgment call a deterministic check can't make (visual
hierarchy, imagery quality, "does this look generic"), so it's the one
LLM call in the pipeline that receives images rather than only text.
See agents/prompts/planning_visual_review.md for the full instructions,
including the "only describe what's visible" guardrail — this must
never be the source of an invented metric or business claim, only
agents/planning_audit.py's measured signals may state those.
"""

from pathlib import Path

from pydantic import BaseModel

from app.agents.base import AgentResult
from app.agents.planning_audit import Finding
from app.integrations.llm import generate_structured

PROMPT_VERSION = "planning_visual_review-v1"
_PROMPT_PATH = Path(__file__).parent / "prompts" / "planning_visual_review.md"


class PlanningVisualReviewInput(BaseModel):
    screenshot_desktop_base64: str | None
    screenshot_mobile_base64: str | None


class PlanningVisualReviewOutput(BaseModel):
    findings: list[Finding]


def _load_system_prompt() -> str:
    return _PROMPT_PATH.read_text(encoding="utf-8")


def run(input: PlanningVisualReviewInput) -> AgentResult[PlanningVisualReviewOutput]:
    images = [img for img in (input.screenshot_desktop_base64, input.screenshot_mobile_base64) if img]
    if not images:
        return AgentResult(
            output=PlanningVisualReviewOutput(findings=[]),
            confidence=1.0,
            notes="No screenshots were captured — nothing to review visually.",
        )

    schema = PlanningVisualReviewOutput.model_json_schema()
    raw = generate_structured(
        system=_load_system_prompt(),
        user="Review the attached desktop and/or mobile screenshot(s) of this business's homepage.",
        schema=schema,
        images_base64=images,
    )
    output = PlanningVisualReviewOutput.model_validate(raw)
    return AgentResult(output=output)
