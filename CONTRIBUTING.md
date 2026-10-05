# Contributing

Humans steer; agents execute; the repository is the system of record. Whether you are a person or an agent, the loop is the same.

## The loop

1. **Orient.** Read `AGENTS.md`, then the row in its "where to look next" table for your area.
2. **Decide in writing.** A non-obvious choice gets a decision record in `docs/design-docs/decisions/` (copy the template at the top of `docs/design-docs/index.md`) and a row in the index. Multi-step work gets an exec plan in `docs/exec-plans/active/` with `## Progress` and `## Decision log` sections.
3. **Types, then tests, then code.** Write the signature first. Write the law or property the change must satisfy. Then implement.
4. **`pnpm check`** must be green: typecheck, invariants, tests (including the structural test and the example), and the benchmark ratio. If an invariant fires, apply the fix in its message. Widening an allowlist requires a sentence in the relevant decision record.
5. **Update the record.** Benchmarks moved → `docs/references/benchmarks.md` and the README table. A grade changed → `docs/QUALITY_SCORE.md`. Any user-visible change → `CHANGELOG.md`. Plan done → move it to `docs/exec-plans/completed/`.
6. **Hostile self-review** before opening a PR: every exported error type is a union of named tags; no `default` over a union; no new allocation on a hot path; no new runtime dependency; docs links resolve.
7. **Open the PR** with the decision record linked. CI runs the same `pnpm check`.

## Style

- Data-first functions, `readonly` everywhere, early returns in hot paths, combinators elsewhere.
- Doc comments state intent and the decision they implement, not what the code obviously does.
- Error messages in tooling end with `— fix: …`.

## Commit messages

Imperative subject, body explains why, reference the decision (`See docs/design-docs/decisions/0002-...`).
