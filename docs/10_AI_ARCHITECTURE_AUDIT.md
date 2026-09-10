# 10 — AI architecture audit (T8, final)

Repository-wide audit after the T5–T8 provider-migration series
(PRs #53–#56). Companion to [[02_ARCHITECTURE]] §6 and
[[09_AI_WEBSITE_PIPELINE]].

---

## 1. AI architecture — before

- One adapter, `integrations/llm.py`, wrapping a single Anthropic
  client. **Every** LLM-calling agent went through it, so **every** AI
  task — routine summaries and creative website work alike — ran on the
  premium Claude model.
- `integrations/ai/router.py` + `providers/` + `tasks.py` existed (T3)
  but **were wired into nothing** — the T3 report describes them as
  "ready for a future migration PR".
- `agents/review_intelligence.py` and `agents/follow_up.py` had been
  moved onto the router (PR #47); `agents/meeting_brief.py` followed
  (PR #48). Everything else still called `llm.py`.
- No per-execution record of which model ran what, what it cost, or
  what failed. No provider health check. Generic "AI generation failed"
  / "couldn't reach the local AI server" errors.

## 2. AI architecture — after

```
Feature service ── calls ──▶ agents/<role>.py
                                  │  names an AITask, nothing else
                                  ▼
                    integrations/ai/router.py
                    ├─ tasks.py: LOCAL_TASKS / PREMIUM_TASKS (asserted total + disjoint)
                    ├─ picks provider+model from AI_LOCAL_* / AI_PREMIUM_*
                    ├─ writes one ai_usage_events row (best-effort)
                    └─▶ providers/{ollama,anthropic}_provider.py ─▶ GenerationResult
```

- **All 11 LLM-calling agents route through `router.generate_structured`.**
  Enforced by `tests/test_ai_router.py`:
  `test_no_agent_still_uses_the_legacy_llm_generate_structured`,
  `test_no_agent_module_imports_a_provider_directly`, and the
  `MIGRATED_AGENTS` table.
- `integrations/llm.py` is now a 3-line re-export of
  `LlmUnavailableError` only (kept for `app/main.py`'s exception
  handler and `modules/planning/service.py`). Its `generate_structured`
  is **gone**.
- Provider selection lives **only** in `router.py`. No feature branches
  on provider; `router.is_local(task)` / `router.resolve_model(task)` /
  `router.resolve_provider_and_model(task)` are the single source of
  truth, used by the 7 services that record `model_used`.
- The website-creation pipeline is a **documented premium-only zone**
  ([[09_AI_WEBSITE_PIPELINE]]), enforced by
  `test_website_pipeline_task_never_routes_to_local` (holds even with
  `AI_LOCAL_FALLBACK_TO_PREMIUM=true`).
- Every call writes an `ai_usage_events` row (task, provider, model,
  success, duration, tokens, retries, error category, estimated cost) —
  no prompts, responses, business content, or keys. Admin read API:
  `GET /api/v1/ai-usage/{summary,events}`.
- Provider health: `GET /api/v1/ai/providers/status` — config +
  Ollama model list by default; `?probe=true` adds a 1-token Ollama
  generation and a **free** Anthropic `models.list`. Surfaced in the
  Settings "AI providers" panel.
- Ollama errors now distinguish "server down" / "model not pulled"
  (`AIProviderModelMissingError` → `ollama pull <model>`) / "model
  can't do JSON schema". The app never downloads a model.

## 3. Tasks moved to Ollama (LOCAL)

| AITask | Agent | Notes |
|---|---|---|
| `review_summary` | `review_intelligence.py` | PR #47 |
| `follow_up_recommendation` | `follow_up.py` | PR #47; output clamped downstream |
| `meeting_brief` | `meeting_brief.py` | PR #48; degrade-gracefully, no longer key-gated (T8) |
| `sales_audit` | `sales_audit.py` | **T5** |
| `outreach_drafting` | `outreach.py` | **T5**; bounded sales copy, operator always reviews |
| `planning_summary` | `planning_summary.py` | **T5**; prose from evidence-checked findings, adds nothing |

Dormant LOCAL tasks (defined for agents that make **no** LLM call, or
aren't built): `website_audit`, `lead_summary`, `lead_scoring`,
`google_review_analysis`, `review_theme_extraction`, `research_summary`,
`proposal_generation`, `client_summary`, `project_summary`.

## 4. Tasks remaining on Anthropic (PREMIUM)

| AITask | Agent | Why premium |
|---|---|---|
| `creative_direction` | `creative_director.py` | PR #49→#53; shapes the whole build |
| `sitemap_planning` | `sitemap.py` | **T5**; site structure decisions |
| `website_brief` | `website_brief.py` | **T5**; positioning / SEO / tech direction the client signs off |
| `website_revision` | `website_revision.py` | **T5**; targeted edits to client-visible sections |
| `visual_design_review` | `planning_visual_review.py` | **T5**; screenshot-grounded "does this look generic" — needs vision (Ollama has none) |

Dormant PREMIUM tasks: `website_generation`, `design_refinement`,
`complex_website_reasoning` (`agents/website_generator.py` assembles
templates deterministically and makes no LLM call).

## 5. Current configured local model

`AI_LOCAL_MODEL` = **`qwen3:30b-a3b`** (default in
`app/core/settings.py`; provisional pick from the T2 benchmark).
`AI_LOCAL_PROVIDER` = `ollama`, `OLLAMA_BASE_URL` = `http://localhost:11434`.

## 6. Current configured premium model

`AI_PREMIUM_MODEL` is blank → falls back to `LLM_MODEL` =
**`claude-sonnet-5`**. `AI_PREMIUM_PROVIDER` = `anthropic`.
Cost pricing: `AI_ANTHROPIC_PRICING_USD_PER_MTOK`
(`claude-sonnet-5` = $2 in / $10 out per Mtok by default).

## 7. Remaining direct provider calls (all intentional, all documented)

| Location | Call | Why it's allowed |
|---|---|---|
| `providers/anthropic_provider.py` | `anthropic.Anthropic().messages.create` | the provider implementation |
| `providers/ollama_provider.py` | `httpx.post(.../v1/chat/completions)` | the provider implementation |
| `integrations/ai/health.py` | `anthropic.Anthropic().models.list` | **free**, non-generation reachability probe |
| `integrations/ai/health.py` | `httpx.get(.../api/tags)`, tiny `httpx.post` probe | Ollama reachability / installed-model list |
| `scripts/ai_benchmark/` | its own Ollama HTTP client | standalone operator tool, imports nothing from `app/` |

No agent or feature module calls a provider, an SDK, or an HTTP AI
endpoint directly. No hard-coded model names in code (only
`settings.py` config + doc/test strings). No router bypasses.

## 8. Tests

- **Backend** (`apps/api`): 1139 passed, 0 failed
  (`pytest -q`, real Postgres `webdesignos_test`).
  New this series: `test_ai_pipeline_routing.py` (T5),
  `test_ai_usage.py` (T6, 13), `test_ai_health.py` (T7, 16); updates to
  `test_ai_router.py`, `test_ai_providers.py`, `test_sales_audits.py`,
  `test_end_to_end_workflow.py`.
- **Frontend** (`apps/web`): `vitest` 118 passed; `tsc --noEmit` clean;
  `next build` ✓.
- **Lint**: `eslint .` reports 1 pre-existing error
  (`app/dashboard/layout.tsx:138`, `react-hooks` "setState synchronously
  within an effect", last touched 2026-09-09, before this series) and 4
  pre-existing warnings. Nothing new. There is no CI lint gate.

## 9. Build

`apps/web`: `next build` compiles successfully, 18/18 static pages
generated, all routes present including `/dashboard/settings`.
`apps/api`: imports clean; Alembic single head `f9b5ad0ab10f`
(`ai_usage_events`), `upgrade`/`downgrade` verified on a real DB.

## 10. Known limitations

1. **`layout.tsx:138` eslint error** — pre-existing, unrelated to AI,
   left untouched (T8 forbids speculative changes). Worth a one-line
   cleanup PR.
2. **No live-provider CI coverage** — there is no Ollama or Anthropic
   endpoint in the dev/test environment, so "both providers actually
   generate", "a real website via the premium path", and the health
   probe's happy path are covered with fakes through the real router,
   not live calls. A real end-to-end run needs an operator with both
   configured.
3. **`ai_usage` cost is an estimate** — from configured `$/Mtok` and
   provider-reported token counts. Prompt-cache reads/writes and batch
   discounts are not modelled; a failed call records `cost_usd = null`
   even though a little may have been spent.
4. **`ai_usage` has no `workspace_id`** — the router has no workspace
   context. Fine for the global cost/debug questions T6 targets; a
   per-workspace breakdown would need a request-scoped context var.
5. **Health probe is synchronous** — `?probe=true` can take up to
   ~5 s (Ollama) + a models.list round-trip. The Settings panel loads
   with the fast check and only probes on the explicit "Run live check".
6. **`ai_local_model` default `qwen3:30b-a3b`** is the T2 *provisional*
   pick — never run against the real 8-task benchmark on target
   hardware (the dev laptop can't host the candidates). Revisit before
   relying on local output quality.
7. **One extra DB connection per AI call** — the usage recorder opens
   its own short-lived session so the event survives a caller rollback.
   Negligible at one-operator scale; would need batching at volume.

## 11. Recommended future improvements

1. Fix `layout.tsx:138` and clear the eslint error; consider adding a
   CI lint/test/build gate (there is none today).
2. Run the `scripts/ai_benchmark` suite against a real Ollama host and
   confirm or change `AI_LOCAL_MODEL` with scored results.
3. A tiny read-only "AI usage (last 30 days)" strip in the Settings
   panel (totals + top task by cost) reusing `GET /api/v1/ai-usage/summary`
   — still not a dashboard, just the one number an operator checks.
4. Record `cache_read`/`cache_write` token counts from the Anthropic
   response and price them separately once caching is used.
5. Add a `POST /api/v1/ai/providers/probe` that the operator can run
   from Settings and that also refreshes a cached status, so the panel
   isn't blocking on every load.
6. When `AI_PREMIUM_MODEL` changes, warn if it isn't in
   `AI_ANTHROPIC_PRICING_USD_PER_MTOK` (cost would silently record as
   unknown).
7. Consider a `SYSTEM`/automation attribution on `ai_usage_events` so
   job-runner traffic is separable from operator-triggered traffic.
