"""
Shared shape for every AI/analysis role in this system — see
docs/02_ARCHITECTURE.md §6. `flagged_for_review` is the escape hatch
required by docs/03_AGENT_RULES.md: a role unsure of its own output
flags it instead of passing it through silently.
"""

from typing import Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class AgentResult(BaseModel, Generic[T]):
    output: T
    confidence: float | None = None
    flagged_for_review: bool
    notes: str | None = None
