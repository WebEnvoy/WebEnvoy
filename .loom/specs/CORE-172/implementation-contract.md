# Implementation Contract

## Scope

- Touch only Core Run Record/query/schema/self-check and item-specific Loom carrier for #172/#173/#174/#175.
- Keep cancellation separate from submitted result and keep true writes out of scope.

## Verification

- `pnpm --filter @webenvoy/core-runtime test`
- `pnpm --filter @webenvoy/schemas test`
- `pnpm conformance`
- `pnpm typecheck`
- `git diff --check`
