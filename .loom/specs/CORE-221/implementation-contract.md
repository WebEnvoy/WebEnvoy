# CORE-221 Implementation Contract

## Ownership

- `packages/core/src/harbor-admission.ts` owns public Harbor provider/runtime/resource admission checks.
- `packages/core/src/lode-admission.ts` owns Lode package-lock/resource requirement contract validation.
- `packages/core/src/task-submission.ts` owns admission sequencing.
- `packages/core/src/run-record-store.ts` owns durable Run Record privacy rejection.
- `packages/core/src/*self-check.ts` owns targeted runtime evidence.
- `.loom/work-items/CORE-221.md`, `.loom/progress/CORE-221.md`, and `.loom/specs/CORE-221/**` are item-specific carriers.

## Verification

- `pnpm --filter @webenvoy/core-runtime test`
- `pnpm --filter @webenvoy/schemas test`
- `pnpm conformance`
- `pnpm typecheck`
- `git diff --check`
- `loom fact-chain --target . --json`
- `loom verify --target . --json`
- `loom suite validate --target . --item CORE-221 --json`
- `loom suite carrier validate --target . --item CORE-221 --json`
- `loom suite evidence validate --target . --item CORE-221 --json`
- `loom build --target . --item CORE-221 --build-evidence .loom/specs/CORE-221/build-evidence.json --json`
- PR metadata readback/preflight after PR creation.

## Non-Goals

- No App UI, Harbor/Lode code changes, live site execution, true writes, browser launch/attach, hosted browser, marketplace, batch crawl, CAPTCHA/risk-control bypass, merge, or issue closeout.
- No credentials, cookies, tokens, verification codes, profile storage, raw DOM/HAR/network, raw screenshot/video, CDP/VNC/websocket endpoints, viewer URLs, provider private objects, production private page content, or Lode package bodies in Core Run Records.
