"""
AI task taxonomy — the axis app/integrations/ai/router.py uses to choose
LOCAL (Ollama) vs PREMIUM (Anthropic). Individual features never choose
a provider themselves; they name a task, and only the router decides
where it runs. docs/09_AI_WEBSITE_PIPELINE.md records the reasoning
behind each website-pipeline task's placement and the premium-only rule.

New tasks are added as agents migrate. router.py's assertions require
every task to land in exactly one of LOCAL_TASKS / PREMIUM_TASKS, so a
task added here without also being added there fails at import time, not
silently.
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
    # Turns already-verified review themes + a Planning workspace's own
    # website-audit findings into website/FAQ recommendations and
    # review-to-website gaps — see agents/planning_review_insights.py.
    # Extraction/synthesis over facts already computed elsewhere, same
    # LOCAL rationale as REVIEW_SUMMARY/REVIEW_THEME_EXTRACTION above.
    REVIEW_WEBSITE_INSIGHTS = "review_website_insights"
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
    # "New Website Plan" mode (a Lead with no website to audit) — turns
    # already-verified business/review facts into a website-planning
    # brief. Same LOCAL rationale as REVIEW_WEBSITE_INSIGHTS: synthesis
    # over given facts, not creative/strategic judgment shaping a
    # client-facing deliverable directly. See
    # agents/planning_website_direction.py.
    PLANNING_WEBSITE_DIRECTION = "planning_website_direction"
    # "Research Comparable Websites" — turns already-fetched public-page
    # signals for a small set of comparable sites into market patterns
    # and opportunities. Same LOCAL rationale. See
    # agents/planning_comparable_patterns.py.
    PLANNING_COMPARABLE_PATTERNS = "planning_comparable_patterns"
    # 9-part sales-preparation report over already-gathered evidence
    # (website audit + public search) — app/agents/sales_audit.py. Same
    # "no unsupported claims" / fact-constrained profile as MEETING_BRIEF.
    SALES_AUDIT = "sales_audit"
    # Channel-specific sales outreach / follow-up draft over a lead's
    # own records — app/agents/outreach.py. Bounded structured copy with
    # heavy anti-fabrication guardrails; the operator always reviews the
    # draft before it is sent (docs/03_AGENT_RULES.md).
    OUTREACH_DRAFTING = "outreach_drafting"
    # Turns Planning's already-evidence-checked findings into a short
    # neutral paragraph — app/agents/planning_summary.py. Never adds a
    # finding of its own; pure summarization.
    PLANNING_SUMMARY = "planning_summary"

    # PREMIUM — creative/strategic judgment that directly shapes what a
    # paying client sees; output quality determines website quality. See
    # docs/09_AI_WEBSITE_PIPELINE.md for where each of these sits in the
    # website-creation flow and why it must not run on a local model.
    CREATIVE_DIRECTION = "creative_direction"
    WEBSITE_GENERATION = "website_generation"
    WEBSITE_REVISION = "website_revision"
    DESIGN_REFINEMENT = "design_refinement"
    COMPLEX_WEBSITE_REASONING = "complex_website_reasoning"
    # Recommended site structure (pages, purpose, nav) from the brief +
    # creative direction — app/agents/sitemap.py. One of the core
    # generation-pipeline LLM steps the T1 audit named premium-only.
    SITEMAP_PLANNING = "sitemap_planning"
    # Client-facing website brief: positioning, goals, SEO and technical
    # direction — app/agents/website_brief.py. Shapes the design the
    # client signs off on, so it stays on the premium model.
    WEBSITE_BRIEF = "website_brief"
    # Screenshot-grounded visual/usability judgement ("does this look
    # generic") — app/agents/planning_visual_review.py. The one routed
    # task that sends images; needs a vision-capable premium model.
    VISUAL_DESIGN_REVIEW = "visual_design_review"
