# Spec

## Goal

Define and verify the minimal Core write-side action request guardrail so true writes are rejected or deferred and remain queryable as structured Core Run Records.

## Required Behavior

- Core task submission accepts the existing task-intent `policy.risk` and `policy.execution_intent` enums from the JSON Schema contract.
- A task with `risk=read` and `execution_intent=read` keeps the existing read-only admission path.
- A non-read task policy request is stopped before Lode package admission, Harbor runtime admission, or any executor path.
- True-write requests such as `submit`, `destructive`, `execute_after_approval`, `reconcile_status`, or `request_cancel` return structured failure code `true_write_deferred`.
- Validate-only, draft, preview, or other write-side action request shapes that are not read-only return a structured guardrail failure without executing writes.
- Guardrail failures create failed terminal Run Records with `admission.decision=deferred_true_write`, public `action_risk`, task/capability/package refs where available, and no raw evidence or write execution state.
- Existing run/result/evidence query helpers can read the guardrail Run Record and return a public failure Result Envelope.
- A reusable schema fixture captures the write guardrail Run Record shape.
- Conformance verifies the guardrail fixture through the same query helpers used by the read-only golden fixture.

## Non-Goals

- Do not add a true write executor, approval UI, idempotency implementation, post-check or reconciliation implementation, App UI, SDK/MCP full entrypoints, formal product CLI, API submission endpoint, history search, storage backend, Harbor/Lode/App repository changes, raw evidence retrieval, or real write behavior.

## Suite Applicability

- Suite path: minimal
- Required artifacts: .loom/specs/GH-110/spec.md, .loom/specs/GH-110/plan.md, and .loom/specs/GH-110/implementation-contract.md
- Evidence-map: present for review/merge-ready evidence binding.
- Full-suite artifacts not applicable: suite-index.md, research.md, contracts.md, readiness-checklist.md, consistency-analysis, execution breakdown.
- Rationale: This Work Item adds one bounded Core guardrail over already-established task policy, Run Record, failure, result, evidence-ref, and query contracts. It does not add a write protocol implementation, approval flow, executor, API submission endpoint, App UI, storage backend, or cross-repo dependency.
- Consumer boundary: Review and PR Ready should consume ADR 0004/0005/0008, existing GH-101 through GH-109 contracts, the guardrail fixture, local command results, PR metadata readback, and hosted checks.
- Recheck condition: Require broader suite artifacts when a later PR adds true-write execution, approval persistence/UI, idempotency store, post-check/reconciliation, generated clients, App integration, storage backends, hosted service storage, or cross-repo protocol changes.

## Acceptance

- `pnpm --filter @webenvoy/core-runtime typecheck` passes.
- `pnpm --filter @webenvoy/core-runtime test` passes.
- `pnpm --filter @webenvoy/schemas test` passes.
- `pnpm --filter @webenvoy/conformance typecheck` passes.
- `pnpm --filter @webenvoy/conformance test` passes.
- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm conformance`, and `pnpm smoke` pass.
- `git diff --check` passes.
- `jq empty .loom/bootstrap/init-result.json .loom/specs/GH-110/build-evidence.json packages/schemas/fixtures/write-action-guardrail-run-record.fixture.json` passes.
- `loom doctor`, `loom verify`, `loom fact-chain`, `loom suite validate`, `loom suite carrier validate`, `loom suite evidence validate`, and packaged Loom build flow pass for GH-110 before PR Ready.
- PR body/head readback matches Work Item `GH-110`, branch `work/GH-110-write-guardrail`, repository `WebEnvoy/WebEnvoy`, and current head after every push.
- No true write executor, approval UI, idempotency implementation, post-check/reconciliation implementation, App UI, SDK/MCP full entrypoint, API submission endpoint, storage backend, Harbor/Lode/App edit, raw evidence retrieval, or real write behavior is introduced.
