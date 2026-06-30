# Plan

- Suite path: minimal

## Implementation

- Add one focused ADR for Task Intent Envelope v0, Run lifecycle v0, and Run Record creation rules.
- Record research absorption / trimming / rejection decisions inside the ADR.
- Add minimal GH-38 Loom carrier files and update current status to GH-38.

## Validation

- `git diff --check`
- Available low-cost repository checks.
- Available Loom local checks: `loom doctor --target . --json`, `loom verify --target . --json`, `loom fact-chain --target . --json`, and carrier/build checks if the local wrapper works.
- Hosted checks after PR creation when available.

## Minimal Path Applicability Records

- full-path-artifacts not_applicable rationale: docs-only contract ADR and item-specific Loom carrier; no code, final schema, generated artifact, runtime behavior, fixture, migration, or workflow logic.
- consumer boundary: ADR consumers, GitHub issues #37/#38/#39/#40, PR metadata, Loom current item carrier, and hosted docs/gate checks.
- recheck condition: require full suite when executable code, final schema/API/runtime behavior, generated artifacts, fixtures, workflow logic, or user-facing behavior is introduced.

## Rollback

Revert this docs-only PR if the Stage 2 task/run lifecycle contract conflicts with later accepted ADRs or implementation evidence.

