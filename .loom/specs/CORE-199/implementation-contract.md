# Implementation Contract

## Ownership

- `packages/core/src` owns refs-only real-run query behavior for result, evidence refs, session refs, failure reasons, and recovery hints.
- `packages/api-server/src` owns App-consumable API routes that expose those Core query projections.
- `packages/schemas` owns JSON schemas and fixtures for the query payloads.
- `packages/conformance` owns fixture-backed checks proving the App-facing query contract remains stable.
- `.loom/specs/CORE-199` and `.loom/progress/CORE-199.md` are the item-specific execution carriers.

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
- `loom pr metadata-preflight` after PR body readback

## Non-Goals

- No App UI, Harbor/Lode/App code changes, true writes, live account operation, external visible action, captcha or risk-control bypass, Stage 7 write-side behavior, issue closeout, release evidence, or current pointer retire in the implementation PR.
- No credentials, cookies, tokens, verification codes, profile storage, raw DOM/HAR/network, raw screenshot/video, CDP/VNC/websocket endpoints, viewer URLs, production private page content, Harbor private browser material, or Lode package bodies in Core query responses.
