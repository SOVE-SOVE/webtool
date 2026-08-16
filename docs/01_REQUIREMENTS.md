# Requirements

Status: draft. Every item here should trace to a pipeline stage in
[[00_VISION]] and pass the revenue/human-hours filter — if it doesn't
save time, make money, reduce mistakes, or improve quality, cut it.

## Pipeline stages → requirements

### 1. Prospect

- Surface candidate Australian local/trade businesses worth pitching
  without manual research per lead — name, location, industry, contact
  details.
- Output: a queue of prospects with enough info to triage, not just a
  raw list of names.

### 2. Research (pre-sale)

- Pull public info per prospect: existing web presence (or lack of),
  socials, Google Business listing, industry — enough to judge fit and
  personalize outreach later.

### 3. Website audit

- Automated check of the prospect's current site (if any): loads at
  all, mobile-friendly, HTTPS, page speed, obviously outdated/broken,
  or no site found at all.
- Output is structured and comparable across prospects, not a one-off
  freeform note.

### 4. Lead score

- Combine research + audit into a score/priority so time goes to the
  best-fit leads first, not every candidate equally.
- Avoid wasting time on leads that don't fit the $599–$1,299 offer.

### 5. Sales preparation

- Before outreach, assemble the "why this business, what's wrong, what
  we'd do" packet — no scrambling to find the story on the spot, in the
  outreach draft or on the call.

### 6. Outreach

- Generate first-touch outreach that references the actual audit/
  research findings, not a generic template.
- Track who's been contacted and when, so nothing is re-sent or missed.
- Never sent without operator review, per [[03_AGENT_RULES]].

### 7. Follow-up

- Automated reminders/sequencing so leads go cold from being
  unqualified, not from being forgotten.

### 8. Meeting

- Lightweight scheduling support and a place to capture call notes/
  outcome so it doesn't live only in the operator's memory.

### 9. Client intake

- A structured form/questionnaire that captures agreed scope, price,
  content, branding assets, and preferences in one pass — this seeds
  everything downstream. No re-keying client info by hand.

### 10. Project

- Client intake converts into a project record with its own pipeline
  state (design brief → ... → maintenance), distinct from the lead
  record it came from.

### 11. Research (post-sale)

- Deeper, build-specific research: competitors, industry conventions,
  reference sites, gaps between what the client has and what the site
  needs.

### 12. Design brief

- A structured brief (goals, pages, tone, visual direction) generated
  from intake + research, for operator sign-off before build starts.

### 13. Sitemap

- Page list/structure derived from the brief and the client's service
  offering, using the template baseline in [[packages]].

### 14. Copy

- Draft per-page website copy from intake content + research, in the
  client's actual voice — not generic filler. Editable by operator and
  client before it ships.

### 15. Website

- Assemble the site from [[packages]] templates/components + sitemap +
  copy + client assets. This is the "build" step — never a blank
  canvas.

### 16. QA

- Automated pre-flight checks: build passes, links resolve, mobile
  check, no obvious broken images/spelling issues (see [[tests]]).
- Automated checks assist; they don't replace the human checklist —
  see stage 17.

### 17. My approval

- The operator's own manual gate before a client ever sees a draft.
  Stays human by design — see [[00_VISION]].

### 18. Client approval

- A shareable, secure preview link the client can view and leave
  feedback on.
- Feedback should be incorporable into COPY/WEBSITE without a manual
  rebuild from scratch.

### 19. Deployment

- One-step (or near one-step) deploy to production once approved.
- Tied to payment/invoicing so "live" and "paid" move together, not as
  a separate manual chase.

### 20. Maintenance

- Ongoing monitoring (uptime, broken links) for live client sites.
- The entry point for recurring hosting/maintenance revenue.

## Non-functional requirements

- **Time-to-value over completeness.** A stage that's 80% automated and
  shipped beats a fully automated stage that's still being designed.
- **Traceability** — agent actions on a lead or client project should be
  attributable to a pipeline stage, per [[03_AGENT_RULES]].
- **Quality floor** — nothing in the build/deploy path should ship
  output that reads as templated or AI-generated slop. See
  [[05_DECISIONS]].
- **Solo-operator scale** — designed for one person running many
  projects concurrently around university, not a team. No feature
  should assume a second human in the loop unless it's the client.
- **Client data is sensitive** — PII, payment references, and
  unpublished draft sites need real (if lightweight) security
  treatment. See [[06_SECURITY]].

## Open questions

- Lead sourcing method: which AU-specific data source(s) — Google
  Places, ABN Lookup, industry directories — for stage 1.
- What exactly the stage-16/17 QA checklist covers — this stays manual
  by design, but its scope should be defined so tooling doesn't quietly
  try to automate it away.

Log resolved questions and the reasoning behind them in
[[05_DECISIONS]] rather than editing history here.
