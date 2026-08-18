"""
Meeting preparation role — docs/04_ROADMAP.md M4 ("meeting preparation
system"). Given everything already known about a lead going into an
upcoming sales meeting, produces the BUSINESS/WEBSITE/SALES sections of
the brief entirely from stored records (no LLM call — see
modules/meetings/service.py's `_assemble_brief`) and uses an LLM only
for the two DISCOVERY fields that genuinely require synthesis:
questions to ask and likely requirements. Keeping the fact sections
outside the LLM's reach is a structural guarantee against invented
figures, not just a prompting guardrail. See agents/prompts/
meeting_brief.md for the model instructions.
"""

from pathlib import Path

from pydantic import BaseModel

from app.agents.base import AgentResult
from app.integrations.llm import generate_structured

PROMPT_VERSION = "meeting_brief-v2"
_PROMPT_PATH = Path(__file__).parent / "prompts" / "meeting_brief.md"


class PriorOutreachSummary(BaseModel):
    channel: str
    status: str
    generated_at: str
    excerpt: str


class PriorInteractionSummary(BaseModel):
    kind: str
    occurred_at: str
    summary: str | None


class MeetingBriefDiscoveryInput(BaseModel):
    business_name: str
    industry: str | None
    lead_status: str
    lead_priority: str
    lead_score: int | None
    lead_notes: str | None
    meeting_title: str
    meeting_type: str
    scheduled_at: str
    website_strengths: list[str]
    website_weaknesses: list[str]
    website_opportunities: list[str]
    objections: list[str]
    possible_package: str
    prior_outreach: list[PriorOutreachSummary]
    prior_interactions: list[PriorInteractionSummary]


class MeetingBriefDiscoveryOutput(BaseModel):
    questions_to_ask: list[str]
    likely_requirements: list[str]


def _load_system_prompt() -> str:
    return _PROMPT_PATH.read_text(encoding="utf-8")


def _format_list(label: str, items: list[str], empty: str) -> str:
    if not items:
        return f"{label}: {empty}"
    lines = [f"{label}:"]
    lines.extend(f"- {item}" for item in items)
    return "\n".join(lines)


def _format_prior_outreach(items: list[PriorOutreachSummary]) -> str:
    if not items:
        return "Outreach history: no prior outreach on record — this is the first documented contact."
    lines = ["Outreach history (most recent first):"]
    for item in items:
        lines.append(f"- [{item.generated_at}] {item.channel} ({item.status}): {item.excerpt}")
    return "\n".join(lines)


def _format_prior_interactions(items: list[PriorInteractionSummary]) -> str:
    if not items:
        return "Prior interactions: none on record — this is the first documented touchpoint."
    lines = ["Prior interactions (most recent first):"]
    for item in items:
        summary = f" — {item.summary}" if item.summary else ""
        lines.append(f"- [{item.occurred_at}] {item.kind}{summary}")
    return "\n".join(lines)


def _build_user_message(input: MeetingBriefDiscoveryInput) -> str:
    return "\n\n".join(
        [
            "BUSINESS / LEAD RECORD",
            f"Name: {input.business_name}\n"
            f"Industry: {input.industry or 'unknown'}\n"
            f"Lead status: {input.lead_status}\n"
            f"Priority: {input.lead_priority}\n"
            f"Lead score: {input.lead_score if input.lead_score is not None else 'not scored'}\n"
            f"Lead notes: {input.lead_notes or 'none'}",
            "THIS MEETING",
            f"Title: {input.meeting_title}\nType: {input.meeting_type}\nScheduled: {input.scheduled_at}",
            "WEBSITE AUDIT FINDINGS (from the latest Sales Audit, if any — ground truth, do not add to it)",
            _format_list("Strengths", input.website_strengths, "none recorded"),
            _format_list("Weaknesses", input.website_weaknesses, "none recorded"),
            _format_list("Opportunities", input.website_opportunities, "none recorded"),
            "KNOWN OBJECTIONS (from the latest Sales Audit, if any)",
            _format_list("Objections", input.objections, "none recorded"),
            "PACKAGE ALREADY SUGGESTED (fixed — do not propose a different one or a different price)",
            input.possible_package,
            "OUTREACH HISTORY",
            _format_prior_outreach(input.prior_outreach),
            "INTERACTION HISTORY",
            _format_prior_interactions(input.prior_interactions),
        ]
    )


def run(input: MeetingBriefDiscoveryInput) -> AgentResult[MeetingBriefDiscoveryOutput]:
    schema = MeetingBriefDiscoveryOutput.model_json_schema()
    raw = generate_structured(
        system=_load_system_prompt(),
        user=_build_user_message(input),
        schema=schema,
    )
    output = MeetingBriefDiscoveryOutput.model_validate(raw)

    thin_evidence = (
        not input.website_strengths
        and not input.website_weaknesses
        and not input.website_opportunities
        and not input.prior_outreach
        and not input.prior_interactions
    )

    return AgentResult(
        output=output,
        confidence=0.5 if thin_evidence else 0.85,
        flagged_for_review=thin_evidence,
        notes="No sales audit, prior outreach, or prior interaction history available — discovery section is a "
        "best effort from the business/lead record alone."
        if thin_evidence
        else None,
    )
