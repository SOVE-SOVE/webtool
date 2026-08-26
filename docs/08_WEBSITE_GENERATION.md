# Website Generation Architecture

Status: decided — this is the "Phase 5: AI Website Production" architecture
the operator asked for. It formalizes roadmap [[04_ROADMAP]] M5 ("Website
build + QA + approval") plus the tail of M4 (design direction, sitemap),
and sets the shape that Phase 5's remaining tasks (content generation,
component structure, preview, revisions) build into. See
[[02_ARCHITECTURE]] §6 for the general AI-role architecture this follows.

## The pipeline

```
CLIENT BRIEF
   → DESIGN DIRECTION
   → SITEMAP
   → CONTENT
   → COMPONENT STRUCTURE
   → WEBSITE CODE
   → PREVIEW
   → REVISIONS
   → DEPLOYMENT
```

This is the same stages-8-through-19 slice of the master pipeline in
[[00_VISION]] (brief → sitemap → copy → website → QA → my approval →
client approval → deployment), named the way the build side of the
business actually thinks about it. Every arrow above is a **hard stage
boundary**: each stage produces a stored, typed, human-reviewable
artifact; the next stage reads that artifact, never the raw brief or a
single freeform prompt. Nothing downstream regenerates a stage that
hasn't been approved without the operator explicitly triggering it.

## Why not "one prompt generates a website"

A single "generate me a website" prompt collapses design judgment,
information architecture, copywriting, and layout into one
un-inspectable step — the definition of AI slop this business's whole
pitch (see [[00_VISION]]) is competing against. This system instead
pins each concern to its own stage, its own agent, its own DB rows, and
its own approval gate:

- **Every stage is independently reviewable and editable**, not just
  regenerable. An operator can accept the sitemap and reject the design
  direction, fix one section's copy without touching the rest, or
  re-run only the stage that's wrong — because each stage's output is a
  real row (or set of rows), not a hidden intermediate token stream.
- **Later stages only ever consume earlier stages' *approved* (or, if
  none yet, latest) output**, never the operator's original one-line
  ask. A sitemap is built from the *brief*, not from "build a site for a
  plumber." Website copy (once built) reads from the sitemap page's
  `purpose`/`key_sections`/`required_content`, not from re-describing
  the business from scratch.
- **No stage is allowed to invent facts the client didn't supply.**
  Every agent in this pipeline follows [[03_AGENT_RULES]]'s
  facts-vs-assumptions discipline and a deterministic
  `flagged_for_review` escape hatch — see §6 of [[02_ARCHITECTURE]] for
  the shared `AgentResult` shape every stage returns.
- **Quality is checked structurally, not hoped for.** `agents/
  anti_slop.py` scores generated content against explicit anti-slop
  rules (generic copy, unverified claims, stock-photo tropes,
  repetitive structure) at generation time, and `agents/technical_qa.py`
  runs six categories of automated checks (performance, responsiveness,
  accessibility, SEO, functionality, security) before anything is
  called ready. Neither is advisory-only text bolted onto a prompt —
  both are real, scored, stored reports.

## Stage-by-stage

| # | Stage | Produces | Built by | Status |
|---|-------|----------|----------|--------|
| 1 | Client brief | `DesignBrief` (business/brand/content/website/assets, ~35 fields) | `modules/design_briefs/` | Built (M4) |
| 2 | Design direction | `CreativeDirectionBrief` (concept, visual/colour/typography/spacing/imagery/component/layout/UX direction, brand personality, tone, CTA strategy, references, facts/assumptions) | `agents/creative_director.py` / `modules/creative_directions/` | Built (M4), extended this phase — see task 2 below |
| 3 | Sitemap | `Sitemap` + `SitemapPage` rows (purpose, target audience, primary/secondary CTA, sections, required content/assets, SEO intent, conversion goal, nav placement, nesting) | `agents/sitemap.py` / `modules/sitemaps/` | Built (M4), extended this phase — see task 3 below |
| 4 | Content | Per-page copy drafts, grounded in the brief + sitemap's `required_content` | Not yet built | Open (roadmap M4's last unchecked item) |
| 5 | Component structure | Section-config list per page, drawn from a registry of typed, reusable components | `packages/site-templates` (17 sections on 8 primitives, `getSectionsForPageType()`) + `agents/website_generator.py`'s assembly step | Built (M5) |
| 6 | Website code | A versioned `Website` row: nav + footer + per-page section configs, composing only real brief/sitemap/copy fields — no section is built on invented content | `agents/website_generator.py` / `modules/websites/` | Built (M5) |
| 7 | Preview | A way for the operator (and eventually the client) to see the assembled site rendered, not just its JSON config | Not yet built — today the operator reviews a JSON config editor, no live render | Open |
| 8 | Revisions | A structured "change this" loop distinct from hand-editing raw config | Partial — per-section Approve/Edit/Regenerate exists; no client-facing revision-request capture yet | Partial (M5) |
| 9 | Deployment | A `Deployment` row, gated on every prior checkpoint + pre-deploy checks | `modules/deployments/` | Built (M6) |

Quality gates that cut across every stage above: `agents/anti_slop.py`
(stage 5/6, scores every generation), `agents/technical_qa.py` (stage
6→7, six-category automated report), and `modules/approvals/` (seven
checkpoints — brief, creative direction, sitemap, website, QA, client
review, deployment — each independently re-verified server-side, never
trusted from an earlier gate). See [[04_ROADMAP]] M5 for the build
history and [[05_DECISIONS]] for the reasoning behind each.

## Priorities, and how each is structurally enforced (not aspirational)

- **Quality** — `agents/anti_slop.py` scores every generation
  0-100 against explicit, checkable rules (generic/cliché copy,
  repeated phrasing, unverified superlative claims, stock-photo hosts,
  placeholder alt text) rather than trusting a prompt to "make it good."
- **Consistency** — every section renders through
  `packages/site-templates`' shared primitives (Section, Container,
  Heading, Button, Media, Card, CardGrid, Form); no stage writes raw
  HTML/CSS from scratch, so every generated site inherits the same
  visual and structural grammar.
- **Responsiveness** — a required, checked property, not a hope: the
  section primitives are responsive by construction, and
  `agents/technical_qa.py`'s responsiveness category checks real
  rendered output (cross-viewport overflow) once a preview URL exists.
- **Accessibility** — `agents/technical_qa.py`'s accessibility category
  (missing alt text, unlabeled form fields, duplicate `<h1>`s, computed
  colour contrast once rendered) plus `anti_slop`'s placeholder-alt-text
  check catch violations before client review, not after.
- **Maintainability** — one shared, versioned component package
  (`packages/site-templates`) generates every client site; there is no
  per-client forked codebase to maintain. Every generation is a new
  versioned `Website` row, so a bad regeneration never destroys a good
  prior version.
- **Human approval** — `modules/approvals/`'s seven checkpoints are the
  literal implementation of this priority: no stage is silently skipped
  or bypassed, every approval action re-checks its own prerequisites
  server-side, and editing an approved stage's content reverts it to
  draft, requiring re-approval rather than silently keeping stale
  sign-off attached to changed content.

## What this phase deliberately does not do

Per [[04_ROADMAP]]'s "explicitly not roadmapped" list and
[[00_VISION]]'s non-goals: this is not a generic no-code site builder, not
a multi-agent orchestration framework deciding its own next step, and not
a from-scratch code generator. The pipeline's stage sequencing *is* the
orchestration — driven by API routes and explicit operator actions, the
same way every other AI role in [[02_ARCHITECTURE]] §6 already works.
Agents don't call each other; there is no autonomous loop deciding what
to build next.

## Open work this phase still needs (tracked in [[04_ROADMAP]] M4/M5)

- A real content/copywriting stage between sitemap and component
  structure — today `agents/website_generator.py` composes sections
  directly from brief/sitemap fields, which is honest but not the same
  as a reviewable per-page copy draft.
- A rendered preview (stage 7) — today "preview" is a JSON config editor
  on `/dashboard/projects/[id]/website`, not a rendered page. `modules/
  qa_reports`'s live-check pipeline already proves a `preview_url` can be
  fetched and inspected once one exists (`integrations/browser.py`'s
  `fetch_qa_signals`); nothing yet serves the generated config as an
  actual page.
- A structured, client-facing revision-request capture (stage 8) —
  today revision is "the operator edits the JSON config or regenerates a
  section"; there's no way for a client to leave a scoped "change this"
  request that becomes a trackable, actionable item.
