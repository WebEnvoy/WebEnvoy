# CORE-172 Progress

## Dynamic Facts

- Item ID: CORE-172
- Current Checkpoint: implementation_validated
- Current Stop: approval request record, cancellation Run Record, pending/expired/blocked states, and approval/cancellation query fixture are implemented locally.
- Next Step: Create PR and run hosted gate.
- Blockers: None recorded.
- Latest Validation Summary: `pnpm --filter @webenvoy/core-runtime test`; `pnpm --filter @webenvoy/schemas test`; `pnpm conformance`; `pnpm typecheck`; `git diff --check`; `loom verify --target . --json`; `loom fact-chain --target . --json`; `loom suite validate --target . --item CORE-172 --json`; `loom suite evidence validate --target . --item CORE-172 --json`; `loom suite carrier validate --target . --item CORE-172 --json` passed locally.
- Recovery Boundary: Core approval/cancellation refs and query truth only; no approval execution, true writes, submitted results, unknown outcome, reconciliation, App UI, Lode package truth, or Harbor raw/private material.
- Current Lane: stage6 approval cancellation semantics
