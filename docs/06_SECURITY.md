# Security

Status: draft — a working checklist, not a compliance document. This is
a single-user internal tool, but it holds real client PII and touches
payments, so it gets real (if lightweight) treatment. Revisit as stages
in [[00_VISION]] go from designed to built.

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
- **SSRF protection on outbound fetches (built).** A lead's website URL
  is untrusted input a real person could point at `localhost`, a private
  IP, or a cloud metadata endpoint. `app/integrations/safe_http.py` is
  the only sanctioned way anything in this codebase fetches such a URL:
  it resolves DNS itself, rejects private/loopback/link-local/CGNAT/
  reserved addresses (IPv4 and IPv6), pins the connection to the
  validated IP (closing the DNS-rebinding gap), and re-validates every
  redirect hop. See [[05_DECISIONS]] and `tests/test_safe_http.py`.
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

## Explicitly out of scope for now

- Formal compliance frameworks (SOC2, etc.) — irrelevant at this scale.
- Multi-user access control — see [[03_AGENT_RULES]] and
  [[02_ARCHITECTURE]], this is a one-operator tool.

Record security-relevant decisions and incidents in [[05_DECISIONS]].
