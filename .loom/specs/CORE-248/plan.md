# CORE-248 Plan

## Phases

1. Tighten Core evidence lookup validation so every Harbor response must positively match the requested evidence ref and expose available access.
2. Keep terminal read completion fail-closed for malformed, mismatched, unavailable, expired, missing, or request-failed evidence lookups.
3. Preserve existing same-origin scene URL, read-only policy, Lode admission, and Harbor session failure boundaries.
4. Extend API self-check to assert mismatched/malformed evidence lookup responses do not produce terminal success or copied evidence refs.
5. Run focused Core/API typecheck and tests, then workspace typecheck and diff check.
6. Create PR with clear coverage/non-coverage and leave App E2E open.

## Validation

- `pnpm --filter @webenvoy/core-runtime typecheck`
- `pnpm --filter @webenvoy/api-server typecheck`
- `pnpm --filter @webenvoy/core-runtime test`
- `pnpm --filter @webenvoy/api-server test`
- `pnpm typecheck`
- `git diff --check`
