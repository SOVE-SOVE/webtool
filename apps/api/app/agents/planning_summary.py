"""
Planning's Website Summary role — writes the short neutral paragraph
from an already-evidence-checked list of findings (agents/
planning_audit.py's deterministic findings plus agents/
planning_visual_review.py's screenshot-grounded ones). This agent never
adds a finding of its own; per agents/prompts/planning_summary.md it is
only allowed to turn the given findings into flowing prose — the "Key
Points" the operator sees are exactly those same findings, unmodified.
"""

from pathlib import Path

from pydantic import BaseModel

from app.agents.base import AgentResult
from app.agents.planning_audit import Finding
from app.integrations.llm import generate_structured

PROMPT_VERSION = "planning_summary-v1"
_PROMPT_PATH = Path(__file__).parent / "prompts" / "planning_summary.md"


class PlanningSummaryInput(BaseModel):
    business_name: str
    has_website: bool
    findings: list[Finding]


class PlanningSummaryOutput(BaseModel):
    website_summary: str


def _load_system_prompt() -> str:
    return _PROMPT_PATH.read_text(encoding="utf-8")


def _format_findings(findings: list[Finding]) -> str:
    if not findings:
        return "No findings — the audit found nothing worth flagging."
    lines = []
    for f in findings:
        lines.append(f"- [{f.area}/{f.category}, {f.severity}] {f.message} (evidence: {f.evidence})")
    return "\n".join(lines)


def _build_user_message(input: PlanningSummaryInput) -> str:
    return (
        f"Business: {input.business_name}\n"
        f"Has a website on record: {'yes' if input.has_website else 'no'}\n\n"
        f"FINDINGS (evidence-checked — use only these):\n{_format_findings(input.findings)}"
    )


def run(input: PlanningSummaryInput) -> AgentResult[PlanningSummaryOutput]:
    schema = PlanningSummaryOutput.model_json_schema()
    raw = generate_structured(
        system=_load_system_prompt(),
        user=_build_user_message(input),
        schema=schema,
    )
    output = PlanningSummaryOutput.model_validate(raw)
    return AgentResult(output=output)
