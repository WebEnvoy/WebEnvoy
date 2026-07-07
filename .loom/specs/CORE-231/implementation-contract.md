# CORE-231 Implementation Contract

## Ownership

- `packages/core/src/real-site-write-preview.ts` owns write-precheck generation from existing submission/admission/query primitives.
- `packages/core/src/real-site-write-preview-self-check.ts` owns targeted Xiaohongshu/BOSS write-precheck behavior evidence.
- `packages/core/src/index.ts` owns public export.
- `packages/core/src/self-check.ts` owns self-check registration.
- `.loom/work-items/CORE-231.md`, `.loom/progress/CORE-231.md`, `.loom/status/current.md`, and `.loom/specs/CORE-231/**` are item-specific/shared carrier updates for this batch.

## Verification

- `pnpm --filter @webenvoy/core-runtime test`
- `pnpm --filter @webenvoy/schemas test`
- `pnpm --filter @webenvoy/conformance test`
- `pnpm conformance`
- `pnpm typecheck`
- `git diff --check`
- `loom fact-chain --target . --json`
- `loom verify --target . --json`
- `loom suite validate --target . --item CORE-231 --json`
- `loom suite carrier validate --target . --item CORE-231 --json`
- `loom suite evidence validate --target . --item CORE-231 --json`
- `loom build --target . --item CORE-231 --build-evidence .loom/specs/CORE-231/build-evidence.json --json`
- PR metadata readback/preflight after PR creation.

## Non-Goals

- No App UI #238-#247 implementation.
- No Harbor or Lode code changes.
- No live production site access, real account credentials, browser launch/attach, true writes/submits, approval execution, post-submit reconciliation, hosted browser, marketplace, bulk collection, or account cloud hosting.
- No credentials, cookies, tokens, profile storage, raw DOM, HAR, network bodies, screenshot/video body, CDP/VNC/websocket endpoints, viewer URLs, provider private objects, production private page content, or Lode package bodies in Core.
