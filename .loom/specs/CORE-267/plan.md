# CORE-267 Plan

## Phases

1. Extend Lode resolution to consume the canonical runtime-consumption allowlist.
2. Add explicit public query validation to App-facing task submit input.
3. Invoke Harbor read-operations after admission and validate completed response truth.
4. Map valid public summaries and opaque refs into Core run/result/evidence projections.
5. Fail closed on unavailable, drift, missing refs, or post-check mismatch.
6. Add focused in-process and built-process regressions, then run full repository validation.
7. Review, PR, hosted gate, merge, post-merge evidence, and merged-runtime live E2E.

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

