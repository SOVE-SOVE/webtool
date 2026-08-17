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
  limiting or a hard budget cap per agent run.
- **Scraping etiquette.** Respect robots.txt and reasonable rate limits
  when researching/auditing prospect sites — legal and practical risk,
  not just politeness.

## Open findings (from the 2026-08-18 M0-M3 phase review)

Audited and confirmed solid: bcrypt password hashing; signed, expiring
session cookies (httponly, samesite=lax, secure configurable via
`SESSION_COOKIE_SECURE`); CORS locked to an explicit origin list, never
a wildcard; every route workspace-scoped via a join back to
`businesses.workspace_id` (or, for admin-only routes, gated by role) —
audited module by module, no gaps found; role checks (`require_admin`)
always build on top of authentication, never replace it; no raw SQL
anywhere (SQLAlchemy ORM/Core throughout, no injection surface); every
agent prompt that receives scraped or search-result text explicitly
marks it as data to summarize, never instructions to follow; secrets
never appear in logs; `.env*` gitignored, `.env.example` has no real
values; 0 known vulnerabilities in frontend dependencies (`npm audit`).

Two gaps this doc already called for, but that aren't implemented yet:

- **No cost/rate limiting on paid API calls.** Any workspace member can
  call "Generate sales audit" / outreach / follow-up as many times as
  they want — each is a real, billed Anthropic (and, for search, Brave)
  API call. This doc's "Cost/rate limits on paid APIs" control has no
  implementation. Fix before this is used at any real volume.
- **No SSRF hardening on website audits.** `integrations/browser.py`'s
  `fetch_page_signals()` drives headless Chromium to whatever URL is
  stored in `businesses.website_url`, with no scheme allowlist and no
  block on loopback/link-local/private-IP/cloud-metadata targets.
  Currently only trusted, authenticated workspace members can set that
  field, which limits severity today — but there's no defense if that
  changes (e.g. the field gets populated from a lower-trust source
  later). Add a URL/IP allowlist check before navigation.
- **"Scraping etiquette" (robots.txt, rate limits) is still just a
  stated intent**, not implemented in `integrations/browser.py`.

## Explicitly out of scope for now

- Formal compliance frameworks (SOC2, etc.) — irrelevant at this scale.
- Automated dependency-vulnerability scanning (no Dependabot/pip-audit/
  CI configured at all yet) — fine at current team size, revisit once
  this deploys anywhere real.

Record security-relevant decisions and incidents in [[05_DECISIONS]].
