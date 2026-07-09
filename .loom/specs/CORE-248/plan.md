# CORE-248 Plan

## Phases

1. Add Core completion helper for read-only submitted tasks that have valid Harbor scene/evidence refs.
2. Keep non-read and write-precheck submissions out of this completion path.
3. Preserve existing fail-closed behavior for Lode/Harbor/input failures.
4. Extend API self-check to assert terminal run status, result envelope, evidence refs, and capability-run status counts.
5. Run focused Core/API typecheck and tests, then workspace typecheck and diff check.
6. Create PR with clear coverage/non-coverage and leave App E2E open.

## Validation

- `pnpm --filter @webenvoy/core-runtime typecheck`
- `pnpm --filter @webenvoy/api-server typecheck`
- `pnpm --filter @webenvoy/core-runtime test`
- `pnpm --filter @webenvoy/api-server test`
- `pnpm typecheck`
- `git diff --check`
