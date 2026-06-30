# Plan

- Suite path: minimal

## Implementation

- Update ADR 0003 with Result Envelope shape, failure taxonomy, Run Record fields/terminal states/retention/redaction, task/run/result query shape, upstream fact consumption, and research absorption boundaries.
- Update ADR 0004 with Lode resource requirement consumption, Harbor runtime facts consumption, admission decisions, action request v0, validate/draft/preview/true-write boundaries, upstream fact consumption, and research absorption boundaries.
- Add GH-45 Loom carrier files and update current status to GH-45.

## Validation

- `git diff --check`
- JSON validation for edited/new `.json` files.
- `loom fact-chain --target <worktree> --json`
- `loom suite validate --target <worktree> --item GH-45 --json`
- `loom suite carrier validate --target <worktree> --item GH-45 --json`
- Hosted checks after PR creation.

## Minimal Path Applicability Records

- full-path-artifacts not_applicable rationale: docs-only ADR and item-specific Loom carrier; no code, final schema, generated artifact, fixture file, runtime behavior, storage, migration, evidence capture, workflow logic, viewer behavior, or user-facing behavior.
- consumer boundary: ADR consumers, GitHub issues #44/#45/#46/#47/#48/#49/#50/#51/#52/#53/#54/#55, downstream Core/App/Harbor/Lode contract consumers, PR metadata, Loom current item carrier, and hosted docs/gate checks.
- recheck condition: require full suite when executable code, final schema/API/runtime behavior, generated artifacts, fixture files, workflow logic, storage, evidence capture, conformance runner, viewer behavior, or user-facing behavior is introduced.

## Rollback

Revert this docs-only PR if the Stage 2 Result/Admission contract conflicts with later accepted ADRs or implementation evidence.
