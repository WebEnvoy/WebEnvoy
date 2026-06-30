# Plan

- Suite path: not_applicable

## Implementation

- Add `docs/README.md` for minimal docs directory semantics.
- Add `docs/contracts/README.md` as a contract index pointing to accepted ADRs.
- Update `docs/draft/README.md` with lifecycle rules and the full draft inventory table.
- Replace promoted draft long-form documents with short pointers to authoritative ADRs/contracts.
- Remove obsolete roadmap draft in favor of root `ROADMAP.md`.
- Add GH-71 Loom carrier and update current status to GH-71.

## Validation

- `git diff --check`
- Validate `.loom/**/*.json` with `jq`.
- Available Loom local checks: `loom fact-chain --target . --json`, `loom suite validate --target . --json`, and `loom suite carrier validate --target . --json`.
- Hosted checks after PR creation.

## Suite N/A Records

- full-path-artifacts not_applicable rationale: docs-only closeout; no code, final schema, API/runtime behavior, generated facts, fixture file, migration, or workflow logic.
- consumer boundary: docs readers, GitHub issues #69/#70/#71/#72/#73, PR metadata, GH-71 Loom carrier, and hosted docs/gate checks.
- recheck condition: require full suite or stronger validation when code, final schema/API/runtime behavior, generated facts, fixtures, migrations, workflow logic, conformance runner, or user-facing behavior is introduced.

## Rollback

Revert this docs-only PR if the draft closeout conflicts with later accepted ADRs or product planning truth.
