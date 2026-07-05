# CORE-167 Implementation Contract

## Verification

- `pnpm --filter @webenvoy/core-runtime test`
- `pnpm --filter @webenvoy/schemas test`
- `pnpm conformance`
- `pnpm typecheck`
- `git diff --check`
- `loom verify --target . --json`
- `loom fact-chain --target . --json`
- `loom suite validate --target . --item CORE-167 --json`
- `loom suite evidence validate --target . --item CORE-167 --json`
- `loom suite carrier validate --target . --item CORE-167 --json`

## Boundary

Core owns action request, risk classification, no-submit guard, admission, Run Record, and schema fixture truth. Lode remains package truth owner; Harbor remains runtime/evidence refs owner. This item does not perform true writes or approval execution.

