# Implementation Contract

## Ownership

- packages/core/src owns task admission, run lifecycle, result envelope completion, capability attribution, interruption state expression, and query behavior.
- packages/schemas owns JSON fixtures that demonstrate refs-only real-site Run Record shapes.
- packages/conformance owns fixture/query conformance for the added real-site records.
- .loom/specs/CORE-195 and .loom/progress/CORE-195 are the item-specific carriers for this PR.

## Verification

- `pnpm --filter @webenvoy/core-runtime test`
- `pnpm --filter @webenvoy/schemas test`
- `pnpm conformance`
- `pnpm typecheck`
- `git diff --check`
- `loom fact-chain --target . --json`
- `loom verify --target . --json`
- `loom suite validate --target . --item CORE-195 --json`
- `loom suite carrier validate --target . --item CORE-195 --json`
- `loom suite evidence validate --target . --item CORE-195 --json`
- `loom pr metadata-preflight` after PR body readback

## Non-Goals

- No App UI, Harbor/Lode/App code changes, live account operation, external visible action, captcha bypass, batch task scheduler, true writes, Stage 7 write-side behavior, merge, issue closeout, release evidence, or current pointer retire.
- No credentials, cookies, tokens, verification codes, profile storage, raw DOM/HAR/network, raw screenshot/video, CDP/VNC/websocket endpoints, viewer URLs, production private page content, or site package body persistence in Core.
