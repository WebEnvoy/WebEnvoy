# Plan

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

## Rollback

Revert this docs-only PR if the guidance conflicts with a later Loom contract.
