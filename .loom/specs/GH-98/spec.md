# Spec

## Goal

Create the first machine-readable WebEnvoy Core schema and fixture carriers for task intent, run record, result envelope, and evidence refs without implementing persistence or runtime behavior.

## Required Behavior

- `packages/schemas` exists as a workspace package.
- The package contains JSON Schema files for:
  - task intent
  - Run Record
  - result envelope
  - evidence ref
- Each schema declares:
  - a stable `$id`
  - `schema_version`
  - contract owner
  - status
  - compatibility boundary
  - source ADR locators
  - field-owner metadata for the main field families
- Representative fixture files bind to the local schema files and matching `schema_version` values.
- The package self-check consumes the schema and fixture files and fails on missing owner/status/compatibility metadata or fixture/schema version drift.
- Root workspace scripts include the schema package in build/typecheck/test/lint.
- README documents the schema package self-check command.
- GH-98 item-specific Loom carriers bind the Work Item, branch, scope, and validation plan.

## Non-Goals

- Do not implement Run Record persistence, storage choice, query endpoints, API task submission, admission runtime execution, OpenAPI, generated types, Ajv validation, CLI/MCP/SDK/App integration, Harbor/Lode/App repository changes, real browser execution, or true writes.
- Do not claim FR #94 complete; #99 and #100 remain open.
- Do not close #98 in this PR body; closeout happens after merge evidence is recorded.

## Suite Applicability

- Suite path: minimal
- Required artifacts: .loom/specs/GH-98/spec.md and .loom/specs/GH-98/plan.md
- Evidence-map: present for review/merge-ready evidence binding.
- Full-suite artifacts not applicable: suite-index.md, research.md, contracts.md, readiness-checklist.md, consistency-analysis, execution breakdown.
- Rationale: This Work Item is a narrow schema/fixture carrier PR. It lands machine-readable contract files and a local self-check, but does not implement API behavior, persistence, admission, query, runtime execution, generated consumers, or cross-repo integration.
- Consumer boundary: Review and PR Ready should consume the schema files, fixtures, package self-check, root workspace checks, README command documentation, GH-98 carrier, local command results, PR metadata readback, and hosted checks.
- Recheck condition: Require broader suite artifacts and conformance runner evidence when a later PR adds full JSON Schema validation, Run Record persistence, API submit/query behavior, admission execution, generated types, CLI/MCP/SDK/App-facing API, Harbor/Lode consumption, or true-write guardrails.

## Acceptance

- `pnpm build`, `pnpm typecheck`, `pnpm --filter @webenvoy/schemas test`, `pnpm test`, and `pnpm lint` pass locally.
- `git diff --check` passes.
- `packages/schemas` contains the four schema files and four representative fixtures listed in the work item artifacts.
- No runtime dependency is added for schema validation in GH-98.
- No API Server behavior changes are introduced.
