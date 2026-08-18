"""
Meeting preparation role — docs/02_ARCHITECTURE.md §6 lists this as
"M3/deferred, build only if meeting volume justifies it"; the operator
has now asked for it explicitly as part of Calendar Integration. Turns
whatever is already known about a lead (sales audit, prior outreach,
prior meetings) into a short pre-meeting brief via integrations/llm.py —
no new external data is fetched here, this only synthesizes existing
records. See agents/prompts/meeting_brief.md for the model instructions.
"""

from pathlib import Path

from pydantic import BaseModel

from app.agents.base import AgentResult
from app.integrations.llm import generate_structured

PROMPT_VERSION = "meeting_brief-v1"
_PROMPT_PATH = Path(__file__).parent / "prompts" / "meeting_brief.md"


class PriorOutreachSummary(BaseModel):
    channel: str
    status: str
    generated_at: str
    excerpt: str


class PriorMeetingSummary(BaseModel):
    scheduled_at: str
    outcome: str | None
    notes: str | None


class MeetingBriefInput(BaseModel):
    business_name: str
    industry: str | None
    lead_status: str
    lead_priority: str
    lead_score: int | None
    lead_notes: str | None
    meeting_title: str
    meeting_type: str
    scheduled_at: str
    latest_sales_audit_summary: str | None
    prior_outreach: list[PriorOutreachSummary]
    prior_meetings: list[PriorMeetingSummary]


class MeetingBriefOutput(BaseModel):
    summary: str
    talking_points: list[str]
    open_items: list[str]


def _load_system_prompt() -> str:
    return _PROMPT_PATH.read_text(encoding="utf-8")


def _format_prior_outreach(items: list[PriorOutreachSummary]) -> str:
    if not items:
        return "No prior outreach on record — this is the first documented contact."
    lines = ["Prior outreach (most recent first):"]
    for item in items:
        lines.append(f"- [{item.generated_at}] {item.channel} ({item.status}): {item.excerpt}")
    return "\n".join(lines)


def _format_prior_meetings(items: list[PriorMeetingSummary]) -> str:
    if not items:
        return "No prior meetings on record — this is the first meeting with this lead."
    lines = ["Prior meetings (most recent first):"]
    for item in items:
        outcome = item.outcome or "no outcome recorded"
        notes = f" — {item.notes}" if item.notes else ""
        lines.append(f"- [{item.scheduled_at}] {outcome}{notes}")
    return "\n".join(lines)


def _build_user_message(input: MeetingBriefInput) -> str:
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
            "LATEST SALES AUDIT",
            input.latest_sales_audit_summary or "No sales audit has been generated for this lead yet.",
            "OUTREACH HISTORY",
            _format_prior_outreach(input.prior_outreach),
            "MEETING HISTORY",
            _format_prior_meetings(input.prior_meetings),
        ]
    )


def run(input: MeetingBriefInput) -> AgentResult[MeetingBriefOutput]:
    schema = MeetingBriefOutput.model_json_schema()
    raw = generate_structured(
        system=_load_system_prompt(),
        user=_build_user_message(input),
        schema=schema,
    )
    output = MeetingBriefOutput.model_validate(raw)

    thin_evidence = (
        input.latest_sales_audit_summary is None
        and not input.prior_outreach
        and not input.prior_meetings
    )

    return AgentResult(
        output=output,
        confidence=0.5 if thin_evidence else 0.85,
        flagged_for_review=thin_evidence,
        notes="No sales audit, prior outreach, or prior meeting history available — brief is a best "
        "effort from the business/lead record alone."
        if thin_evidence
        else None,
    )
