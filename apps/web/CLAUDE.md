@AGENTS.md

Before starting work, check:
- `docs/05_DECISIONS.md` for prior architecture/design decisions
- `docs/07_SESSION_LOG.md` for where the last session left off

After finishing work, add an entry to `docs/07_SESSION_LOG.md` following
the template at the top of that file.

## UI/UX delegation

- **Delegate UI/UX tasks to the "UI and UX Apple" subagent** (`ui-and-ux-apple`, defined in `.claude/agents/ui-and-ux-apple.md`, which preloads the `ui-ux-pro-max` and `apple-design` skills): layout, spacing, typography, visual hierarchy, interaction states, motion, responsive behaviour and accessibility in `apps/web`. Give it one small, clearly scoped task, naming the files involved and what "done" looks like.
- **Main Claude coordinates and reviews.** Define the scope, delegate, then review the diff and the agent's reported checks before reporting to the user. Re-run anything it lists as "not completed". Backend, data and non-UI logic stay with the main assistant. New dependencies, backend changes and wider redesigns need the user's approval.
- **Avoid concurrent edits to the same files.** Do not edit files the "UI and UX Apple" agent is working on while it runs, and do not run two agents on overlapping files — sequence them.
- **Explicit user instructions override delegation** (for example, if the user asks main Claude to make a UI change directly, do so).
