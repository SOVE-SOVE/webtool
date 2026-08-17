"""
The shared agent interface, per docs/02_ARCHITECTURE.md §6. Every agent
is `def run(input: XInput) -> AgentResult[XOutput]`; `flagged_for_review`
is the escape hatch required by docs/03_AGENT_RULES.md — an agent unsure
of its own output flags it instead of passing it through silently.
"""

from typing import Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class AgentResult(BaseModel, Generic[T]):
    output: T
    confidence: float | None = None
    flagged_for_review: bool = False
    notes: str | None = None
