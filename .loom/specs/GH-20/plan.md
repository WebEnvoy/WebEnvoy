# Plan

- Suite path: minimal

## Implementation

- Update existing ADRs with the read-only task wedge, result/failure/evidence boundary, research absorption table, and early write-side boundary.
- Add item-specific Loom carrier files under GH-20.
- Do not add product code, package scaffolding, new large spec directories, generated artifacts, or issue closeout comments.

## Validation

- `git diff --check`
- Local available Loom gate or direct hosted-equivalent entry
- Hosted `py-compile`, `demo-bootstrap`, `repo-local-cli`, `loom-check`, and `loom-pr-merge-gate`

## Minimal Path Applicability Records

- full-path-artifacts not_applicable rationale: this PR changes ADR documentation and item-specific Loom carrier files only; consumer boundary: suite validation, review, merge-ready, and closeout consume the ADR decision tables plus GH-20 carrier; recheck condition: require full suite or stronger validation if this PR adds executable code, schema/API/runtime behavior, generated facts, fixtures, workflow logic, or user-facing behavior.

## Rollback

Revert this docs-only PR if the boundary conflicts with later cross-repo contract decisions.
