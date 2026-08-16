# Vision

## The point

This is not a startup. This is a machine that lets one person make money
from web design while studying at university, by automating everything
around the work that isn't the work.

Time should go to:

- Sales
- Talking to people
- Creative decisions
- Final QA

Time should NOT go to:

- Copying leads into spreadsheets
- Researching businesses manually
- Writing repetitive emails
- Remembering follow-ups
- Formatting client information
- Starting websites from scratch
- Manually checking basic website errors
- Repetitive deployment tasks
- Admin

The software handles as much of the second list as reliably possible, so
time is spent on the first.

## The pipeline

```
PROSPECT
   → RESEARCH
   → WEBSITE AUDIT
   → LEAD SCORE
   → SALES PREPARATION
   → OUTREACH
   → FOLLOW-UP
   → MEETING
   → CLIENT INTAKE
   → PROJECT
   → RESEARCH
   → DESIGN BRIEF
   → SITEMAP
   → COPY
   → WEBSITE
   → QA
   → MY APPROVAL
   → CLIENT APPROVAL
   → DEPLOYMENT
   → MAINTENANCE
```

Two macro phases sit inside this: **sales** (prospect → meeting) turns a
cold lead into a signed client, and **delivery** (client intake →
maintenance) turns a signed client into a paid, live, maintained site.
`RESEARCH` appears twice on purpose — once to qualify a prospect before
spending outreach effort on them, once to brief the actual build once
they're a paying client. This supersedes the earlier 8-stage summary of
the same idea — see [[05_DECISIONS]] for why it was expanded.

Every part of this system should map to a stage in that pipeline. If a
piece of work doesn't move a project along this line, it's not in scope.

## Market

Initial target: Australian small businesses, particularly local service
businesses and trades (plumbers, electricians, landscapers, cleaners,
etc.) — the kind of business that often has no site, or one that's
years out of date. This shapes where prospecting/research looks and
what an "audit" checks for.

## Offer

Affordable professional websites, roughly $599 (simple), $899 (main
package), $1,299+ (more involved), plus optional recurring hosting/
maintenance. The strategy is to compete on efficiency and accessibility
— not by pretending the work is worth less. The end product still needs
to look genuinely good. AI slop is unacceptable — output quality is a
hard constraint, not a nice-to-have.

## The optimization target

**Revenue / human hours.**

If a feature does not save time, make money, reduce mistakes, or improve
quality, it is not a priority. This is the filter for every feature
decision in [[01_REQUIREMENTS]] and every phase in [[04_ROADMAP]] — when
in doubt, cut it.

## Who this is for

One operator (initially): a solo web designer who wants to run this like
a lean, high-leverage freelance operation, not build headcount or manage
a team. Scale comes from automation, not hiring.

## What success looks like

- Lead-to-deploy pipeline stages that used to eat hours run with minimal
  manual input, without producing embarrassing or broken output.
- The operator's actual hours are concentrated on sales, creative
  direction, and QA — the parts a client is paying a human for.
- Output quality stays high enough that $899 reads as a good deal, not a
  discount signal.

## Non-goals

- Not a general-purpose no-code app builder — scope is affordable
  professional business websites, not arbitrary software.
- Not trying to replace the operator's judgment on creative direction,
  client relationships, or final sign-off — the system executes and
  assists; the human decides and closes.
- Not optimizing for feature count, generality, or "startup" scale.
  Optimizing for revenue per hour of one person's time.

## Status

This is the north star. Every requirement, architecture choice, and
agent rule should trace back to the pipeline and the revenue/hour metric
above — see [[01_REQUIREMENTS]], [[03_AGENT_RULES]], and [[05_DECISIONS]]
for how that plays out in practice.
