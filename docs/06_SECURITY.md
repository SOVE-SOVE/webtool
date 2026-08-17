# Security

Status: draft — a working checklist, not a compliance document. This is
a small internal team tool (multi-user since 2026-08-16, see
[[05_DECISIONS]]), but it holds real client PII and touches payments, so
it gets real (if lightweight) treatment. Revisit as stages in
[[00_VISION]] go from designed to built.

## What's actually at risk here

- Client PII: names, emails, phone numbers, business details, intake
  answers.
- Prospect data scraped from the public web.
- Unpublished client site drafts (stage 18, client approval) before
  they're meant to be public.
- API keys for every integration in [[02_ARCHITECTURE]] (LLM, search,
  email, hosting, payments, error monitoring).
- No card data — Stripe-hosted checkout/payment links keep this app
  entirely out of PCI scope. Never build a custom card form.

## Controls

- **Auth on the OS app.** Even single-user, the dashboard must never be
  reachable without login. No "it's obscure so it's fine."
- **Secrets management.** All API keys in environment variables, never
  committed. `.env*` gitignored from day one. Production secrets live
  in the hosting platform's env var store, not in code.
- **Client-approval links (stage 18).** Unguessable tokens, not
  sequential/guessable IDs, since a draft site may contain a client's
  unpublished branding/content. Consider expiry once real usage shows
  how long links actually need to stay live.
- **Untrusted content stays data.** Scraped prospect-site text and
  search results are inputs to summarize, never instructions an agent
  follows — a hostile or broken page shouldn't be able to redirect what
  a research/audit agent does. See [[03_AGENT_RULES]].
- **Generated site output.** Client-provided copy/testimonials/form
  input rendered on generated sites must be escaped — no trusting
  client-submitted content to be safe HTML.
- **Contact forms on generated client sites** need basic spam
  protection (honeypot/rate-limit) and server-side validation before
  anything hits email or the database.
- **Database backups.** Use a managed Postgres provider with automatic
  backups (Neon/Supabase) — losing the prospect/client database is a
  business-ending event, not an inconvenience.
- **Cost/rate limits on paid APIs.** A bug that loops an LLM or search
  call shouldn't be able to run up an unbounded bill — basic rate
  limiting or a hard budget cap per agent run. **Implemented
  2026-08-18** — `app/core/rate_limit.py`, an in-process per-user
  sliding-window limiter (`LLM_RATE_LIMIT_PER_MINUTE`, default 10)
  shared across the Sales Audit, Outreach, and Follow-up generation
  endpoints. See [[05_DECISIONS]] for why in-process rather than
  Redis-backed.
- **SSRF hardening on website audits.** `integrations/browser.py`'s
  `fetch_page_signals()` now rejects any `website_url` that isn't a
  public, routable `http(s)` address before navigating — blocks
  loopback, link-local (including the cloud metadata address), private
  ranges, and non-http(s) schemes. **Implemented 2026-08-18.** Known
  residual gap: only the initial target is checked, not addresses
  reached via redirect during navigation — see the caveat in
  `_check_url_is_public`'s docstring and [[05_DECISIONS]].
- **Scraping etiquette.** Respect robots.txt and reasonable rate limits
  when researching/auditing prospect sites — legal and practical risk,
  not just politeness. **Still not implemented** — the SSRF fix above
  only blocks unsafe *targets*, not scrape-politeness for allowed ones.

## Review history

**2026-08-18 (M0-M3 phase review):** Audited and confirmed solid: bcrypt
password hashing; signed, expiring session cookies (httponly,
samesite=lax, secure configurable via `SESSION_COOKIE_SECURE`); CORS
locked to an explicit origin list, never a wildcard; every route
workspace-scoped via a join back to `businesses.workspace_id` (or, for
admin-only routes, gated by role) — audited module by module, no gaps
found; role checks (`require_admin`) always build on top of
authentication, never replace it; no raw SQL anywhere (SQLAlchemy
ORM/Core throughout, no injection surface); every agent prompt that
receives scraped or search-result text explicitly marks it as data to
summarize, never instructions to follow; secrets never appear in logs;
`.env*` gitignored, `.env.example` has no real values; 0 known
vulnerabilities in frontend dependencies (`npm audit`). Found two gaps
this doc already called for but that weren't implemented — cost/rate
limiting and SSRF hardening, both above — closed the same day; robots.txt
etiquette remains open.

## Explicitly out of scope for now

- Formal compliance frameworks (SOC2, etc.) — irrelevant at this scale.
- Automated dependency-vulnerability scanning (no Dependabot/pip-audit/
  CI configured at all yet) — fine at current team size, revisit once
  this deploys anywhere real.

Record security-relevant decisions and incidents in [[05_DECISIONS]].
