# CORE-227 Plan

## Phases

1. Bind a fresh branch/worktree to CORE-227 from reviewed carrier commit `20b5683a`.
2. Align Core with Harbor `387265eb` and Lode `e36a4a7`, including the current mirror hash and BOSS city transport.
3. Validate public summaries by operation and reject all trust-boundary drift.
4. Add symmetric BOSS success and negative self-check coverage while retaining XHS behavior and refs-only boundaries.
5. Run focused and full repository validation, review the diff, then create a ready PR without merge or issue closure.

## Validation

- `pnpm --filter @webenvoy/core-runtime typecheck`
- `pnpm --filter @webenvoy/api-server typecheck`
- `pnpm --filter @webenvoy/core-runtime test`
- `pnpm --filter @webenvoy/api-server test`
- `pnpm --filter @webenvoy/api-server build`
- `node packages/api-server/dist/runtime-task-submit-self-check.js`
- `node packages/api-server/dist/runtime-process-self-check.js`
- `pnpm typecheck`
- `pnpm test`
- `pnpm lint`
- `git diff --check`
- Loom fact-chain/suite/build checks
