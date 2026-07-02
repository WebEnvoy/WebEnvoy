# Plan

## Implementation

1. Reuse the existing task-intent policy enums, Run Record admission decision, failure taxonomy, and result/evidence query helpers.
2. Extend task submission parsing to preserve non-read policy values instead of rejecting them before a Run Record can be created.
3. Add a guardrail branch before Lode/Harbor admission that records non-read requests as failed/deferred Run Records.
4. Keep true-write requests distinct from validate/draft/preview action-request shapes through structured failure codes.
5. Add Core self-check assertions proving true-write and preview/action-request guardrails are terminal, queryable, and do not call execution.
6. Add a reusable write guardrail Run Record fixture under schemas.
7. Extend conformance to seed and query the guardrail fixture through existing run/result/evidence helpers.
8. Update concise docs for Core, schemas, conformance, and root README.
9. Add GH-110 item-specific Loom carriers and current status alignment.
10. Run local validation and refresh evidence before PR creation.

## Constraints

- Keep implementation dependency-free.
- Use existing JSON Schema fields and Run Record/failure/query shapes.
- Do not add approval UI, idempotency implementation, post-check/reconciliation implementation, App UI, SDK/MCP full entrypoints, formal product CLI, API submission endpoint, true write executor, raw evidence retrieval, or real write behavior.
- Do not modify Harbor, Lode, App, or other repositories.
- Do not close FR #96 until GH-110 is merged, closed, and post-merge evidence is complete.

## Validation

- `pnpm --filter @webenvoy/core-runtime typecheck`
- `pnpm --filter @webenvoy/core-runtime test`
- `pnpm --filter @webenvoy/schemas test`
- `pnpm --filter @webenvoy/conformance typecheck`
- `pnpm --filter @webenvoy/conformance test`
- `pnpm build`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm conformance`
- `pnpm smoke`
- `git diff --check`
- `jq empty .loom/bootstrap/init-result.json .loom/specs/GH-110/build-evidence.json packages/schemas/fixtures/write-action-guardrail-run-record.fixture.json`
- `loom doctor --target . --json`
- `loom verify --target . --json`
- `loom fact-chain --target . --json`
- `loom suite validate --target . --item GH-110 --json`
- `loom suite carrier validate --target . --item GH-110 --json`
- `loom suite evidence validate --target . --item GH-110 --json`
- packaged `loom_flow.py flow build --target . --item GH-110 --build-evidence .loom/specs/GH-110/build-evidence.json`
- PR body/head readback after push and PR creation.

## Closeout Boundary

- This PR should reach PR Ready for Work Item #110 only.
- After GH-110 is merged and closed, verify all FR #96 sub-issues are closed before closing FR #96.
- After FR #96 is closed, close milestone #9 only if GitHub reports `open_issues=0`.
