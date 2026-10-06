# 0012 — Coverage is part of the complete project check
Status: accepted        Date: 2026-10-05

## Context
The library's CI measured coverage, but `pnpm check` and the release workflow did not. The checker package had no coverage configuration, and the architecture test only verified a compliant repository. Fresh review found 99.83% library line coverage but 87.06% checker line coverage, including an entirely untested CLI. Passing tests still missed cancellation, decoding, and checker defects.

## Decision
`pnpm check` includes coverage, bundle checks, and the separate checker package's complete validation. Both coverage configurations enforce minimums per file, so aggregate coverage cannot conceal an untested module. The architecture checker is included in measured coverage and tested against synthetic compliant and violating repositories. Tests demonstrate defects before their fixes; law and schedule properties remain mandatory.

## Evidence
The expanded suites reproduced the defects recorded in the amendments to decisions 0005, 0006, 0009 and 0010. CLI tests cover exit codes, options, diagnostics, JSON and strict review mode. Negative invariant tests exercise every source rule, layers, dependency restrictions, docs, plans and property suite requirements.

## Alternatives
CI-only thresholds leave local and release checks incomplete. A global percentage lets a large tested module mask a small untested one. Coverage alone does not prove behavior, so it accompanies regression, property and consumer tests.

## Consequences
The actual minimums live in [the library configuration](../../../vitest.config.ts) and [checker configuration](../../../tools/check/vitest.config.ts): 95% statements, lines and functions, and 90% branches in every executable file. HTML and JSON reports are ignored generated artifacts. No threshold or source allowlist was widened to accommodate a failing check.
