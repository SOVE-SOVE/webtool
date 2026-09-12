# 09 — AI in the website-creation pipeline

Companion to [[02_ARCHITECTURE]] §6. This doc traces every AI touch-point
in the "build the client's website" half of the pipeline
([[00_VISION]] stages INTAKE → DEPLOYMENT), says which provider each one
runs on and why, and records the deliberate rule that the **premium
model is never traded away for a local one on this path**.

Provider routing itself lives in `app/integrations/ai/router.py`; the
LOCAL/PREMIUM placement of every task is in `app/integrations/ai/tasks.py`.
Nothing below picks a provider itself — each step names an `AITask` and
the router decides.

---

## 1. The pipeline at a glance

```
 LEAD / SALES SIDE (local intelligence, produced once)
   business_research      LOCAL*   deterministic fetch — no LLM
   website_audit          LOCAL*   deterministic Playwright/HTTP checks — no LLM
   review_intelligence    LOCAL    AITask.REVIEW_SUMMARY / …
   sales_audit            LOCAL    AITask.SALES_AUDIT       → business_summary, strengths,
                                                              top_problems, suggested_structure,
                                                              suggested_offer
        │
        ▼   (these outputs are passed forward, never recomputed)
 WEBSITE-CREATION SIDE (premium creative judgment)
   website_brief          PREMIUM  AITask.WEBSITE_BRIEF
   sitemap                PREMIUM  AITask.SITEMAP_PLANNING
   creative_director      PREMIUM  AITask.CREATIVE_DIRECTION
   website_generator      —        deterministic assembly — no LLM
   anti_slop              —        deterministic checks — no LLM
   website_revision       PREMIUM  AITask.WEBSITE_REVISION
   technical_qa           —        deterministic checks — no LLM
   planning_visual_review PREMIUM  AITask.VISUAL_DESIGN_REVIEW (vision — images)
```

\* "LOCAL" for `business_research` / `website_audit` means "not premium
work" — they make **no model call at all**, so there is nothing to
route. They are listed here only because their output feeds the premium
steps.

---

## 2. Where each thing enters

### 1. Creative direction
`app/agents/creative_director.py`, invoked by
`app/modules/creative_directions/service.py::generate_creative_direction`.
Turns the business record + intake brief + prior research into the
visual/brand/tone/CTA direction the rest of the build follows. Routes
as **`AITask.CREATIVE_DIRECTION` (PREMIUM)**.

### 2. Business research
Enters the pipeline on the **lead side**, long before website creation:
`app/agents/business_research.py` (deterministic page fetch) and
`app/agents/sales_audit.py` (`AITask.SALES_AUDIT`, **LOCAL**). Its
distilled outputs — `business_summary`, `website_strengths`,
`top_problems`, `suggested_structure`, `suggested_offer` — are stored on
the `SalesAuditReport` row.

`generate_creative_direction` then **reads those stored fields** and
passes them into `CreativeDirectorInput` as
`prior_research_summary` / `prior_website_strengths` / `prior_top_problems`
/ `prior_suggested_structure` / `prior_suggested_offer`. The premium
model is told the research conclusions; it does not re-crawl the site or
re-derive them. Same for `website_audit` (deterministic) → passed in as
`website_audit`.

### 3. Anti-Slop rules
`app/agents/anti_slop.py` — a **deterministic** checker (banned-phrase
list, exact-duplicate detection, fabricated-testimonial detection,
placeholder detection), not a prompt. It runs:
- inside `website_generator.run()` on every generation, and
- again in `modules/websites/service.py::_recompute_anti_slop` after any
  regeneration or section edit, and at read time.

Anti-Slop is **not** a model instruction that a cheaper model could
"forget" — it is code, and it runs regardless of which model produced
the content. The prompt-level anti-slop guidance in
`agents/prompts/*.md` is a second layer on top, not the enforcement
point. See [[05_DECISIONS]] "AI slop is unacceptable".

### 4. Sitemap decisions
`app/agents/sitemap.py`, invoked by
`app/modules/sitemaps/service.py::generate_sitemap`. Decides which pages
exist, why, what each says/does, and nav placement — from the brief +
creative direction. Routes as **`AITask.SITEMAP_PLANNING` (PREMIUM)**.
The operator reviews/edits/approves the sitemap before generation.

### 5. Component decisions
Two places, neither of which is a free-form LLM choice:
- **Which sections a page gets** — `app/agents/website_generator.py`,
  **deterministic**. It maps sitemap `key_sections` + available brief
  content to section types from `packages/site-templates`' `SiteSection`
  union. It never invents a section it has no real content for; the gap
  goes to `missing_information` instead.
- **How a section is worded/toned** — set upstream by creative direction
  (PREMIUM) and refined by `website_revision` (PREMIUM). The design
  system / section catalogue itself is fixed in `packages/site-templates`
  and is **not** regenerated per project.

### 6. Where prompts are constructed
Each agent builds its own system+user message from a checked-in template
in `app/agents/prompts/<agent>.md` (never an inline string) plus a
`_build_user_message()` that interpolates only real, already-collected
facts. Prompt files carry a `PROMPT_VERSION`, stored on the generated
row for traceability ([[03_AGENT_RULES]]). **These prompts are not
simplified because local AI exists** — the premium path keeps the full
prompts.

### 7. Where the provider is called
Only in `app/integrations/ai/providers/anthropic_provider.py`
(`AnthropicProvider.generate_structured`), reached through
`app/integrations/ai/router.py`. Every website-creation agent calls
`router.generate_structured(task=AITask.<PREMIUM task>, …)`. No agent
imports a provider class (enforced by
`tests/test_ai_router.py::test_no_agent_module_imports_a_provider_directly`)
and no agent still imports the legacy `integrations/llm.py`
`generate_structured` (enforced by
`test_no_agent_still_uses_the_legacy_llm_generate_structured`).

The Anthropic call forces a single `emit_result` tool matching the
agent's JSON schema, so output is parsed JSON, never regex'd prose.

### 8. How generated output is validated
1. **Schema** — the provider forces the response schema; the agent then
   `model_validate`s it into its Pydantic `*Output` type. A miss raises
   `AIProviderError` → 503, nothing saved.
2. **Agent self-check** — e.g. `sitemap.py` flags a `parent_slug` that
   matches no page; `website_revision.py` flags a response that dropped
   `type` or changed the section type. Sets `flagged_for_review`.
3. **Anti-Slop** — deterministic, see (3). Sets `anti_slop_score` /
   `anti_slop_passed` / `flagged_for_review`.
4. **Technical QA** — `app/agents/technical_qa.py`, deterministic,
   enqueued as a job right after generation. Read-only; never an
   auto-gate ([[03_AGENT_RULES]]).
5. **Human approval** — the operator, then the client, per the
   `WebsiteWorkflowStatus` state machine. AI never self-approves.

### 9. How revisions are handled
`app/modules/website_revisions/service.py`:
- A pure spacing/layout tweak is applied **deterministically** — no
  model call.
- A content/tone/copy change goes to `app/agents/website_revision.py`
  → **`AITask.WEBSITE_REVISION` (PREMIUM)**, a *targeted* edit to one
  section's config; `_apply_preserved_approvals` keeps unrelated
  approved sections intact.
- A full regeneration re-runs `website_generator.run()` (deterministic)
  from the current brief/sitemap/creative direction.

### 10. How generated websites are saved
`modules/websites/service.py::generate_website` writes a `Website` row:
`config` (the full section tree as JSON, matching
`packages/site-templates`' `SiteSection` shape), `anti_slop_score`,
`flagged_for_review`, `sources_note`, `generated_by_user_id`. A
regeneration or section edit writes a **new** `Website` row (versioned,
never overwritten); `_apply_preserved_approvals` carries approved
sections forward by (slug, type). Deploy reads the latest
`READY_TO_DEPLOY`/`DEPLOYED` version.

---

## 3. Local → premium handoff (no redundant work)

| Produced by (LOCAL / deterministic) | Stored on | Consumed by (PREMIUM) as |
|---|---|---|
| `business_research` page fetch | — (feeds sales_audit) | — |
| `website_audit` measured signals | `WebsiteAudit` | `CreativeDirectorInput.website_audit` |
| `sales_audit.business_summary` | `SalesAuditReport` | `CreativeDirectorInput.prior_research_summary` |
| `sales_audit.website_strengths` | `SalesAuditReport` | `CreativeDirectorInput.prior_website_strengths` |
| `sales_audit.top_problems` | `SalesAuditReport` | `CreativeDirectorInput.prior_top_problems` |
| `sales_audit.suggested_structure` | `SalesAuditReport` | `CreativeDirectorInput.prior_suggested_structure` |
| `sales_audit.suggested_offer` | `SalesAuditReport` | `CreativeDirectorInput.prior_suggested_offer` |
| intake `DesignBrief` fields | `DesignBrief` | creative direction / sitemap / website brief inputs |
| reviewed creative direction | `CreativeDirectionBrief` | `SitemapInput.creative_direction_notes`, `WebsiteBriefInput` |
| reviewed sitemap | `Sitemap` + `SitemapPage` | `WebsiteBriefInput.sitemap_notes`, `website_generator` pages |

The premium model receives conclusions, not raw material to re-analyse.
If a premium step needs a fact a local step already established, it is
threaded through the agent's typed input — it is never re-fetched or
re-summarised on the premium path.

---

## 4. The rule

**Website-creation AI stays on the premium provider.** The following
`AITask`s are PREMIUM and must never be moved to LOCAL, even though a
local model could technically run them:

`CREATIVE_DIRECTION`, `SITEMAP_PLANNING`, `WEBSITE_BRIEF`,
`WEBSITE_GENERATION`, `WEBSITE_REVISION`, `DESIGN_REFINEMENT`,
`COMPLEX_WEBSITE_REASONING`, `VISUAL_DESIGN_REVIEW`.

Enforced by
`tests/test_ai_router.py::test_website_pipeline_task_never_routes_to_local`
(asserts they route to Anthropic even with
`AI_LOCAL_FALLBACK_TO_PREMIUM` on).

`VISUAL_DESIGN_REVIEW` is also the one routed task that sends images;
the local Ollama provider has no vision path, so the router rejects
images on any LOCAL task outright.

### What is explicitly NOT changed by provider routing
- The website design system in `packages/site-templates`.
- Anti-Slop (`agents/anti_slop.py`) — still deterministic, still runs.
- Creative Director logic and its full prompt.
- Any website generation prompt — none were shortened.
- The visual output — routing changes where a call runs, not what it
  produces.
