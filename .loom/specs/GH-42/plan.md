# Plan

- Suite path: minimal

## Implementation

- Add ADR 0007 for Core reference/version ownership v0.
- Cover capability/package/runtime/profile/identity/evidence/source/resource/caller/run/result refs.
- Define failure mapping for missing, expired, unavailable, unauthorized, redacted, incompatible, invalid_contract, and source/resource trace unavailable.
- Record research absorption / trimming / reference-only / rejection decisions inside the ADR.
- Add GH-42 Loom carrier files and update current status to GH-42.

## Validation

- `git diff --check`
- JSON validation for edited/new `.json` files.
- `loom_flow.py fact-chain --target <worktree>`
- `loom suite validate --target <worktree> --item GH-42 --json`
- `loom suite carrier validate --target <worktree> --item GH-42 --json`
- Hosted checks after PR creation.

## Minimal Path Applicability Records

- full-path-artifacts not_applicable rationale: docs-only contract ADR and item-specific Loom carrier; no code, final schema, generated artifact, fixture file, runtime behavior, migration, evidence storage, workflow logic, or user-facing behavior.
- consumer boundary: ADR consumers, GitHub issues #41/#42/#43, downstream Core/App/Harbor/Lode contract consumers, PR metadata, Loom current item carrier, and hosted docs/gate checks.
- recheck condition: require full suite when executable code, final schema/API/runtime behavior, generated artifacts, fixture files, workflow logic, evidence storage, conformance runner, or user-facing behavior is introduced.

## Rollback

Revert this docs-only PR if the Stage 2 reference/version ownership contract conflicts with later accepted ADRs or implementation evidence.
