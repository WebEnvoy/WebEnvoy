# CORE-271 Implementation Contract

- Preserve the original task/admission/operation failure when cleanup also fails.
- Never project success while release and stop both fail.
- Release/stop only after GET confirms `control_owner=core_task` and `control_lock.holder_ref=run_id`.
- Persist only structured failure/post-check fields and opaque session refs.
- Startup recovery scans non-terminal Run Records only and never takes manual/user/other-owner sessions.
- No App, Harbor, or Lode modifications and no real external activity.

## Verification

- `pnpm --filter @webenvoy/core-runtime typecheck`
- `pnpm --filter @webenvoy/api-server typecheck`
- `pnpm --filter @webenvoy/core-runtime test`
- `pnpm --filter @webenvoy/api-server test`
- `pnpm typecheck && pnpm test && pnpm lint`
- `git diff --check`
