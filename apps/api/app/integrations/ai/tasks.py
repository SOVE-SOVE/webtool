"""
AI task taxonomy — the axis app/integrations/ai/router.py uses to choose
LOCAL (Ollama) vs PREMIUM (Anthropic). Individual features never choose
a provider themselves; they name a task, and only the router decides
where it runs. See the T1 audit report for the reasoning behind each
task's LOCAL/PREMIUM placement.

New tasks can be added as agents migrate (see FOLLOW_UP_RECOMMENDATION,
added when app/agents/follow_up.py migrated — it didn't fit any of the
original T3 task names). router.py's assertions require every task to
land in exactly one of LOCAL_TASKS / PREMIUM_TASKS, so a task added here
without also being added there fails at import time, not silently.
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
    # Next-touch channel/timing recommendation for a lead, bounded and
    # clamped by app/agents/follow_up.py regardless of what the model
    # returns — see that module's docstring.
    FOLLOW_UP_RECOMMENDATION = "follow_up_recommendation"

    # PREMIUM — creative/strategic judgment that directly shapes what a
    # paying client sees; output quality determines website quality.
    CREATIVE_DIRECTION = "creative_direction"
    WEBSITE_GENERATION = "website_generation"
    WEBSITE_REVISION = "website_revision"
    DESIGN_REFINEMENT = "design_refinement"
    COMPLEX_WEBSITE_REASONING = "complex_website_reasoning"
