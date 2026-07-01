# Spec

## Goal

Implement an explicit minimum Run Record lifecycle state machine that prevents skipped, backward, or terminal-to-active transitions while preserving the existing v0 public statuses.

## Required Behavior

- `packages/core` exposes the Run Record lifecycle transition table for runtime and conformance consumers.
- The lifecycle uses ADR 0005 status names: `pending`, `admitted`, `running`, and terminal statuses. The issue wording `accepted` is treated as the historical admission decision wording for public status `admitted`; `canceled` is represented by the existing schema enum `cancelled`.
- New Run Records still default to `pending`.
- Accepted task submission can create an `admitted` Run Record through the existing GH-101 path.
- Admission failures may create terminal `failed`, `cancelled`, or `expired` records through the existing store creation surface.
- `pending` can transition only to `admitted`, `failed`, `cancelled`, or `expired`.
- `admitted` can transition only to `running`, `failed`, `cancelled`, or `expired`.
- `running` can transition only to terminal statuses: `succeeded`, `failed`, `blocked`, `requires_user_action`, `manual_recovery_required`, `unknown_outcome`, `cancelled`, or `expired`.
- Terminal statuses reject any later transition.
- Skipped transitions such as `pending -> running` and `admitted -> succeeded` are rejected.
- The core self-check verifies explicit transition metadata, skipped-transition rejection, terminal rejection, and a direct cancellation path.
- The conformance self-check follows the legal `pending -> admitted -> running -> succeeded` path.
- GH-102 item-specific Loom carriers bind the Work Item, branch, scope, and validation plan.

## Non-Goals

- Do not implement an HTTP lifecycle API, worker loop, retry/recovery orchestration, cancel endpoint, result/failure envelope changes beyond existing Run Record statuses, Harbor runtime binding, Lode package/capability resolution, evidence retrieval, CLI/MCP/SDK/App integration, database/ORM/migration tooling, hosted service storage, or true writes.
- Do not rename public schema statuses or introduce parallel `queued`, `accepted`, or `canceled` status enums.
- Do not claim FR #95 complete; later Work Items and the Lode #89 dependency remain open.
- Do not close #102 in this PR body; closeout happens after merge evidence is recorded.

## Suite Applicability

- Suite path: minimal
- Required artifacts: .loom/specs/GH-102/spec.md, .loom/specs/GH-102/plan.md, and .loom/specs/GH-102/implementation-contract.md
- Evidence-map: present for review/merge-ready evidence binding.
- Full-suite artifacts not applicable: suite-index.md, research.md, contracts.md, readiness-checklist.md, consistency-analysis, execution breakdown.
- Rationale: This Work Item is a narrow Core runtime PR that tightens existing local Run Record lifecycle behavior and self-checks without adding API routes, generated consumers, runtime execution, storage backends, or cross-repo integration.
- Consumer boundary: Review and PR Ready should consume the core runtime transition table, core/conformance self-check output, GH-102 carrier, local command results, PR metadata readback, and hosted checks.
- Recheck condition: Require broader suite artifacts when a later PR adds API submit/query behavior, runtime execution, Lode package/capability consumption, Harbor runtime binding, result projection, evidence retrieval, generated types, CLI/MCP/SDK/App-facing API, database storage, hosted service storage, or true-write guardrails.

## Acceptance

- `pnpm --filter @webenvoy/core-runtime test` passes locally from a clean generated-output state.
- `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `pnpm conformance` pass locally.
- `git diff --check` passes.
- `pending -> admitted -> running -> succeeded` succeeds.
- `pending -> running`, `admitted -> succeeded`, backward transitions, and terminal-to-active transitions are rejected.
- No new runtime dependency, database, ORM, migration framework, API route, hosted storage, or true-write behavior is introduced.
