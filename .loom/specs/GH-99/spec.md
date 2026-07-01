# Spec

## Goal

Implement the first minimal local durable Run Record store so Core can persist accepted/running/terminal/failure/evidence references without introducing a database, hosted service, API route, or runtime executor.

## Required Behavior

- `packages/core` exists as a workspace package named `@webenvoy/core-runtime`.
- The package exposes a file-backed Run Record store.
- The store persists one JSON Run Record per safe `run_id`.
- The store can create, read, update, and list records.
- Record writes use a same-directory temporary file followed by rename.
- Created records use `schema_version` `webenvoy.run-record.v0`.
- The store rejects unsafe `run_id` values that could escape the storage directory.
- Run status transitions are monotonic and terminal states cannot move back to running states.
- Terminal records get `terminal_at` when entering terminal status.
- Failed records must include structured failure data.
- Runtime/evidence/result values are stored as refs, not raw browser, DOM, screenshot, cookie, token, or provider-private material.
- A no-dependency self-check verifies the minimum create/update/reload/failure/ref behavior.
- Root README documents the core runtime self-check command.
- GH-99 item-specific Loom carriers bind the Work Item, branch, scope, and validation plan.

## Non-Goals

- Do not implement API task submission, API query routes, admission runtime execution, result projection, Harbor/Lode/App repository changes, Ajv validation, generated TypeScript types, OpenAPI, CLI/MCP/SDK/App integration, database/ORM/migration tooling, multi-tenant or hosted service storage, true writes, or GH-100 conformance runner behavior.
- Do not claim FR #94 complete; #100 remains open.
- Do not close #99 in this PR body; closeout happens after merge evidence is recorded.

## Suite Applicability

- Suite path: minimal
- Required artifacts: .loom/specs/GH-99/spec.md, .loom/specs/GH-99/plan.md, and .loom/specs/GH-99/implementation-contract.md
- Evidence-map: present for review/merge-ready evidence binding.
- Full-suite artifacts not applicable: suite-index.md, research.md, contracts.md, readiness-checklist.md, consistency-analysis, execution breakdown.
- Rationale: This Work Item is a narrow Core local persistence PR. It lands a minimal file-backed Run Record store and self-check, but does not implement public API routes, runtime admission/execution, generated consumers, or cross-repo integration.
- Consumer boundary: Review and PR Ready should consume the core runtime package, self-check, README command documentation, GH-99 carrier, local command results, PR metadata readback, and hosted checks.
- Recheck condition: Require broader suite artifacts and conformance runner evidence when a later PR adds API submit/query behavior, full schema validation, admission execution, result projection, generated types, CLI/MCP/SDK/App-facing API, Harbor/Lode consumption, database storage, hosted service storage, or true-write guardrails.

## Acceptance

- `pnpm --filter @webenvoy/core-runtime test` passes locally from a clean package build state.
- `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm lint` pass locally.
- `git diff --check` passes.
- `packages/core` provides the file-backed Run Record store and self-check listed in the Work Item artifacts.
- No runtime dependency, database, ORM, migration framework, API route, or hosted storage is introduced.
- No API Server behavior changes are introduced.
