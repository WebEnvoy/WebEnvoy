# Implementation Contract

## Ownership

- packages/core/src owns admission parsing, failure mapping, Run Record creation, and query projection.
- packages/schemas owns JSON Schema and fixtures for the Run Record public binding shape.
- packages/conformance owns shallow fixture validation only.
- .loom/specs/CORE-191 and .loom/progress/CORE-191 are the item-specific carriers for this PR.

## Verification

- `pnpm --filter @webenvoy/core-runtime test`
- `pnpm --filter @webenvoy/schemas test`
- `pnpm conformance`
- `pnpm typecheck`
- `git diff --check`
- `loom fact-chain --target . --json`
- `loom verify --target . --json`
- `loom suite validate --target . --item CORE-191 --json`
- `loom suite carrier validate --target . --item CORE-191 --json`
- `loom suite evidence validate --target . --item CORE-191 --json`

## Non-Goals

- No Harbor/Lode/App changes.
- No live accounts, credentials, cookies, tokens, profile storage, raw browser endpoints, or raw evidence.
- No true writes, Lode site execution, hosted runtime, merge, issue closeout, or current pointer retire.
