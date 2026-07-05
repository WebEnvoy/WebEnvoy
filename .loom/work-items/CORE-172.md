# CORE-172

## Static Facts

- Item ID: CORE-172
- Goal: Express approval request, cancellation Run Record, pending/expired/blocked approval states, and approval/cancellation query fixture for Stage 6 write-precheck flows.
- Scope: Covers Core #172/#173/#174/#175 under FR #171; excludes approval execution, true writes, submitted result, unknown outcome, reconciliation, App UI, Lode package truth, and Harbor raw/private material.
- Execution Path: work/core-172-approval-cancellation
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-172.md
- Review Entry: .loom/reviews/CORE-172.json
- Validation Entry: pnpm --filter @webenvoy/core-runtime test; pnpm --filter @webenvoy/schemas test; pnpm conformance; pnpm typecheck; git diff --check
- Closing Condition: PR merged, #172/#173/#174/#175/#171 closeout evidence posted, and current pointer remains no_active_item.

## Covered Work Items

- #172 write approval request record.
- #173 write cancellation Run Record.
- #174 express pending/expired/blocked approval states.
- #175 provide approval/cancellation query fixture.

## Associated Artifacts

- packages/core/src/run-record-store.ts
- packages/core/src/run-query.ts
- packages/core/src/self-check.ts
- packages/schemas/schemas/approval-request.schema.json
- packages/schemas/schemas/approval-cancellation-query.schema.json
- packages/schemas/fixtures/approval-request-pending.fixture.json
- packages/schemas/fixtures/approval-cancellation-query.fixture.json
- .loom/specs/CORE-172/**
