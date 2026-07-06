# CORE-226 Implementation Contract

## Ownership

- `packages/core/src/read-only-result-projection.ts` owns Lode read-output to Core envelope/failure mapping.
- `packages/core/src/result-envelope.ts` owns completion-time Run Record patching for result/source/projection refs.
- `packages/core/src/result-query.ts` owns query-time envelope reconstruction.
- `packages/core/src/run-record-store.ts` owns durable refs-only validation.
- `packages/core/src/real-site-readonly-result-self-check.ts` owns targeted read-only projection evidence.
- `packages/schemas/**` and `packages/conformance/**` own schema/conformance fixture coverage.
- `.loom/work-items/CORE-226.md`, `.loom/progress/CORE-226.md`, and `.loom/specs/CORE-226/**` are item-specific carriers.

## Verification

- `pnpm --filter @webenvoy/core-runtime test`
- `pnpm --filter @webenvoy/schemas test`
- `pnpm conformance`
- `pnpm typecheck`
- `git diff --check`
- `loom fact-chain --target . --json`
- `loom verify --target . --json`
- `loom suite validate --target . --item CORE-226 --json`
- `loom suite carrier validate --target . --item CORE-226 --json`
- `loom suite evidence validate --target . --item CORE-226 --json`
- `loom build --target . --item CORE-226 --build-evidence .loom/specs/CORE-226/build-evidence.json --json`
- PR metadata readback/preflight after PR creation.

## Non-Goals

- No #230-#234 write-precheck/approval/no-submit implementation.
- No App UI, Harbor/Lode code changes, live external site run, real account credentials, browser launch/attach, true writes, Stage 7, merge, or issue closeout.
- No cookies, tokens, verification codes, profile storage, raw DOM/HAR/network, screenshot/video body, CDP/VNC/websocket endpoints, viewer URLs, provider private objects, production private page content, or Lode package bodies in Core.
