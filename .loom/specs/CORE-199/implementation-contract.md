# Implementation Contract

## Ownership

- packages/core/src owns read-only Run Record query projection, evidence summary shape, session refs query, and failure reason query behavior.
- packages/api-server/src owns additive GET routes for `/runs/:id/session-refs` and `/runs/:id/failure`.
- packages/schemas owns App-facing JSON Schema fixtures for session refs and failure reason query envelopes.
- packages/conformance owns fixture validation for refs-only real-site query surfaces.
- .loom/work-items/CORE-199.md, .loom/progress/CORE-199.md, .loom/status/current.md, .loom/bootstrap/init-result.json, and .loom/specs/CORE-199 are the item-specific Loom carriers for this PR.

## Verification

- `pnpm --filter @webenvoy/core-runtime test`
- `pnpm --filter @webenvoy/api-server test`
- `pnpm --filter @webenvoy/schemas test`
- `pnpm conformance`
- `pnpm typecheck`
- `git diff --check`
- `loom fact-chain --target . --json`
- `loom verify --target . --json`
- `loom suite validate --target . --item CORE-199 --json`
- `loom suite carrier validate --target . --item CORE-199 --json`
- `loom suite evidence validate --target . --item CORE-199 --json`
- `loom build --target . --item CORE-199 --build-evidence .loom/specs/CORE-199/build-evidence.json --json`
- `loom pr metadata-readback` and `loom pr metadata-preflight` after PR body readback.

## Non-Goals

- No #190/#203-#206 behavior, App/Harbor/Lode code changes, true writes, live account operation, external visible action, captcha/risk bypass, merge, issue closeout, release evidence, current-head review, or current pointer retire.
- No Harbor private scene material, account/cookie/token/profile storage, raw DOM, raw network, raw screenshot/video, CDP/VNC/websocket endpoint, viewer URL, Lode package body, fixture body, or validator body copied into Core query envelopes.
