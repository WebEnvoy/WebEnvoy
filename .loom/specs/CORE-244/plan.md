# CORE-244 Plan

## Phases

1. Add Core orchestration for runtime task submission.
2. Add local Lode package resolver from registry/manifest/resource requirement assets.
3. Add Harbor HTTP client for the provided local runtime API endpoints.
4. Expose API server POST `/tasks`.
5. Add focused self-check with mock Lode registry and mock Harbor HTTP server.
6. Add built API server process smoke for App-observed `/admission/health`, configured `/tasks` submit, run/result/evidence/session refs, `/capability-runs`, and terminal failure regressions.
7. Record CORE-244 carrier and validation evidence.

## Validation

- `pnpm --filter @webenvoy/core-runtime typecheck`
- `pnpm --filter @webenvoy/api-server typecheck`
- `pnpm --filter @webenvoy/core-runtime test`
- `pnpm --filter @webenvoy/api-server test`
- `pnpm typecheck`
- `pnpm test`
- `pnpm lint`
- `git diff --check`
