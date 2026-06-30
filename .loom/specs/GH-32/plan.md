# Plan

- Suite path: minimal

## Implementation

- Add a concise Loom / PR / closeout constraint section to `AGENTS.md`.
- Add item-specific Loom carrier files under `GH-32`.
- Do not modify product boundary documents or implementation code.

## Validation

- `git diff --check`
- `loom doctor --target . --json`
- `loom verify --target . --json`
- `loom fact-chain --target . --json`
- Hosted `py-compile`, `demo-bootstrap`, `repo-local-cli`, `loom-check`, and `loom-pr-merge-gate`

## Minimal Path Applicability Records

- full-path-artifacts not_applicable rationale: this PR changes repository agent guidance and Loom documentation carriers only; consumer boundary: suite validation, review, merge-ready, and closeout consume only `AGENTS.md` guidance plus item-specific carrier files; recheck condition: require full suite or stronger validation if this PR adds executable code, schema/API/runtime behavior, generated facts, fixtures, workflow logic, or user-facing behavior.

## Rollback

Revert this docs-only PR if the guidance conflicts with a later Loom contract.
