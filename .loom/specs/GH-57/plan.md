# Plan

- Suite path: minimal

## Implementation

- Add ADR 0006 for common task entry v0.
- Cover shared task submission semantics, API/CLI/MCP/SDK/App projection boundaries, fixture shape, and conformance checklist.
- Record research absorption / trimming / reference-only / rejection decisions inside the ADR.
- Add GH-57 Loom carrier files and update current status to GH-57.

## Validation

- `git diff --check`
- JSON validation for edited/new `.json` files.
- Available Loom local checks: `loom fact-chain --target . --json`, `loom suite validate --target . --json`, and `loom suite carrier validate --target . --json`.
- Hosted checks after PR creation.

## Minimal Path Applicability Records

- full-path-artifacts not_applicable rationale: docs-only contract ADR and item-specific Loom carrier; no code, final schema, generated artifact, fixture file, runtime behavior, migration, or workflow logic.
- consumer boundary: ADR consumers, GitHub issues #56/#57/#58/#59/#60, App #36/#57 downstream fixture consumers, PR metadata, Loom current item carrier, and hosted docs/gate checks.
- recheck condition: require full suite when executable code, final schema/API/runtime behavior, generated artifacts, fixture files, workflow logic, conformance runner, or user-facing behavior is introduced.

## Rollback

Revert this docs-only PR if the Stage 2 common entry contract conflicts with later accepted ADRs or implementation evidence.
