# CORE-275 Implementation Contract

- Core owns normalization from Harbor producer tokens to pinned Lode canonical failures.
- Map only `safety_challenge` to existing `captcha_required`; do not alter Harbor or add a Lode class.
- Validate schema, runtime session, site, operation, retryability, and pinned taxonomy before accepting any unavailable response.
- Unknown tokens remain fail-closed; malformed post-dispatch outcomes remain unknown outcomes.
- Persist only structured failure summaries and opaque refs; no raw browser or sensitive material.

## Verification

- `pnpm --filter @webenvoy/api-server typecheck`
- `pnpm --filter @webenvoy/api-server test`
- `pnpm typecheck && pnpm test && pnpm lint`
- `git diff --check`
