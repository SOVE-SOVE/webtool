"""
AI task taxonomy — the axis app/integrations/ai/router.py uses to choose
LOCAL (Ollama) vs PREMIUM (Anthropic). Individual features never choose
a provider themselves; they name a task, and only the router decides
where it runs. See the T1 audit report for the reasoning behind each
task's LOCAL/PREMIUM placement.

Not yet used by any existing agent (see T3 — this is additive
infrastructure; app.integrations.llm.generate_structured, used by all 9
existing AI call sites, is untouched and keeps working exactly as
before). A future migration PR wires individual agents to
app.integrations.ai.router.generate_structured(task=..., ...) instead.
"""

from enum import Enum


class AITask(str, Enum):
    # LOCAL — routine business intelligence: summarization, extraction,
    # scoring, classification over already-given facts. A cheap/local
    # model's occasional imperfection here is low-risk; several of these
    # already have code-level guards (clamping, schema validation)
    # downstream regardless of what generated them.
    WEBSITE_AUDIT = "website_audit"
    LEAD_SUMMARY = "lead_summary"
    GOOGLE_REVIEW_ANALYSIS = "google_review_analysis"
    REVIEW_SUMMARY = "review_summary"
    REVIEW_THEME_EXTRACTION = "review_theme_extraction"
    LEAD_SCORING = "lead_scoring"
    RESEARCH_SUMMARY = "research_summary"
    MEETING_BRIEF = "meeting_brief"
    PROPOSAL_GENERATION = "proposal_generation"
    CLIENT_SUMMARY = "client_summary"
    PROJECT_SUMMARY = "project_summary"

    # PREMIUM — creative/strategic judgment that directly shapes what a
    # paying client sees; output quality determines website quality.
    CREATIVE_DIRECTION = "creative_direction"
    WEBSITE_GENERATION = "website_generation"
    WEBSITE_REVISION = "website_revision"
    DESIGN_REFINEMENT = "design_refinement"
    COMPLEX_WEBSITE_REASONING = "complex_website_reasoning"
