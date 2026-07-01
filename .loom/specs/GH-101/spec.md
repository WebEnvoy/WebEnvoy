# Spec

## Goal

Implement the first minimum Core runtime task submission path that validates a read-only Task Intent, rejects invalid or private input before admission, and records accepted admission in the local Run Record store.

## Required Behavior

- `packages/core` exports a task submission helper for the read-only minimum path.
- The helper accepts a `Task Intent v0` envelope with user intent, entrypoint, capability reference, input summary/refs, scope, read-only policy, resource requirement refs, and evidence policy ref.
- The helper rejects non-object task intent input.
- The helper rejects unsupported top-level task intent fields while allowing `$schema` as a local fixture carrier field.
- The helper rejects private or raw runtime fields anywhere in the submitted envelope before creating a Run Record.
- Private/raw fields include raw payload, DOM, HAR, screenshot, video, cookie, token, local path, UI state, and runtime session material.
- The helper rejects unsupported schema versions, unsupported entrypoints, missing required strings, invalid refs arrays, and non-read policy.
- Accepted read-only submissions create a durable Run Record with status `admitted`.
- The accepted Run Record stores `admission.decision` as `accepted` and `admission.action_risk` as `read`.
- The accepted Run Record references the task intent id, entrypoint, capability, optional package/resource/runtime/evidence refs, and does not inline raw private material.
- Invalid submissions return a structured `request_invalid` failure and do not create a durable Run Record.
- `packages/core/src/self-check.ts` verifies the accepted submission path and invalid private-field rejection.
- GH-101 item-specific Loom carriers bind the Work Item, branch, scope, and validation plan.

## Non-Goals

- Do not implement HTTP API submission routes, API query routes, CLI/MCP/SDK/App-facing API, Harbor or Lode repository changes, Lode package-body resolution, Harbor runtime session binding, action execution loop, result projection, evidence retrieval, database/ORM/migration tooling, hosted service storage, or true writes.
- Do not claim FR #95 complete; later Work Items and the Lode #89 dependency remain open.
- Do not close #101 in this PR body; closeout happens after merge evidence is recorded.

## Suite Applicability

- Suite path: minimal
- Required artifacts: .loom/specs/GH-101/spec.md, .loom/specs/GH-101/plan.md, and .loom/specs/GH-101/implementation-contract.md
- Evidence-map: present for review/merge-ready evidence binding.
- Full-suite artifacts not applicable: suite-index.md, research.md, contracts.md, readiness-checklist.md, consistency-analysis, execution breakdown.
- Rationale: This Work Item is a narrow Core runtime PR that lands the first accepted admission recording path on top of existing schema fixtures and the local Run Record store, with no public API route, runtime execution, generated consumers, hosted storage, or cross-repo package/runtime consumption.
- Consumer boundary: Review and PR Ready should consume the core runtime helper, core self-check output, GH-101 carrier, local command results, PR metadata readback, and hosted checks.
- Recheck condition: Require broader suite artifacts when a later PR adds API submit/query routes, runtime lifecycle execution, Lode package/capability consumption, Harbor runtime binding, result projection, evidence retrieval, generated types, CLI/MCP/SDK/App-facing API, database storage, hosted service storage, or true-write guardrails.

## Acceptance

- `pnpm --filter @webenvoy/core-runtime test` passes locally from a clean generated-output state.
- `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `pnpm conformance` pass locally.
- `git diff --check` passes.
- The accepted read-only task submission path creates an `admitted` Run Record with `admission.decision` `accepted`.
- Invalid/private input returns a structured failure and does not create a Run Record.
- No new runtime dependency, database, ORM, migration framework, API route, hosted storage, or true-write behavior is introduced.
