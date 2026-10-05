# Execution plans

Plans are first-class, versioned artifacts. Small changes do not need one; anything with more than one step, a decision to make, or work that may span sessions does.

- `active/` — in-progress plans. Each must contain `## Goal`, `## Steps`, `## Progress` (dated checklist), and `## Decision log` (dated entries; anything settled here that is durable also becomes a decision record). The invariants linter checks for the Progress and Decision log sections.
- `completed/` — finished plans, kept as history. Move the file; do not delete it.
- `tech-debt-tracker.md` — known gaps with the condition that retires each.

Template:

```
# NNNN — Title
Owner: (person or agent)   Started: YYYY-MM-DD   Status: active
## Goal
## Steps
1. ...
## Progress
- [x] YYYY-MM-DD step 1 — note
## Decision log
- YYYY-MM-DD — decided X because Y (→ decision 00NN if durable)
```
