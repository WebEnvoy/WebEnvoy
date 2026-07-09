# CORE-223 Plan

## Phases

1. Extend Core Harbor HTTP client with site-resource facts fetch keyed by Lode package ref.
2. Normalize Harbor `harbor-site-resource-facts/v0` into Core public resource admission facts.
3. Preserve existing session, snapshot, and evidence-ref validation behavior.
4. Add no-external API self-check coverage for Xiaohongshu site facts success and unknown fact fail-closed behavior.
5. Record validation evidence and prepare PR metadata.

## Validation

- `pnpm exec tsc -p packages/core/tsconfig.json --noEmit`
- `pnpm --filter @webenvoy/core-runtime build`
- `pnpm exec tsc -p packages/api-server/tsconfig.json --noEmit`
- `pnpm --filter @webenvoy/api-server test`
- `pnpm --filter @webenvoy/core-runtime test`
- `pnpm typecheck`
- `git diff --check`
- `loom fact-chain --target . --json`
- `loom suite validate --target . --item CORE-223 --json`
- `loom suite carrier validate --target . --item CORE-223 --json`
- `loom suite evidence validate --target . --item CORE-223 --json`
