# CORE-267

## Static Facts

- Item ID: CORE-267
- Goal: Drive Harbor's allowlisted real read-operation endpoint and persist only validated public result/evidence refs in Core Run Records.
- Scope: Core API task input, Lode runtime-consumption allowlist resolution, Harbor read-operation invocation, terminal failure mapping, refs-only result projection, focused self-checks, and CORE-267 Loom carriers.
- Execution Path: work/core-267-harbor-read-operation
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-267.md
- Review Entry: .loom/reviews/CORE-267.json
- Validation Entry: pnpm --filter @webenvoy/core-runtime typecheck; pnpm --filter @webenvoy/api-server typecheck; pnpm --filter @webenvoy/core-runtime test; pnpm --filter @webenvoy/api-server test; pnpm --filter @webenvoy/api-server build; node packages/api-server/dist/runtime-task-submit-self-check.js; node packages/api-server/dist/runtime-process-self-check.js; pnpm typecheck; pnpm test; pnpm lint; git diff --check; Loom suite/fact-chain/build checks
- Closing Condition: Implementation PR merged and post-merge contract evidence recorded; #267 remains open until an authorized App-driven live operation on the merged runtime produces valid identity/session/run/result/evidence refs.

## Covered Issues

- #267 Harbor allowlisted read-operation consumption and Core refs-only Run Record projection.

This Work Item is consumed by parent #243 and App #239/#240. It does not close those stories without merged-version live E2E evidence.

## Explicitly Not Covered

- App, Harbor, or Lode code changes.
- Automatic login or reading/storing password, Cookie, verification code, token, raw profile, raw DOM/HAR/screenshot bytes, or CDP endpoints.
- Submit, publish, send, external draft save, bulk collection, hosted browser, marketplace, account cloud hosting, or risk-control bypass.
- BOSS/Xiaohongshu live closeout before the merged Core build is consumed by the packaged App.

## Ownership Constraints

- Product writes are limited to Core runtime task-chain/Lode admission, App-facing task input, focused self-checks, and CORE-267 Loom carriers.
- Harbor owns provider/session/page/evidence truth; Lode owns capability/allowlist truth; Core stores only public summaries and opaque refs.
- Shared current/bootstrap pointers are serially owned by the main controller. Subagents may not modify `.loom/**`, PR metadata, or GitHub state.

## Associated Artifacts

- `.loom/work-items/CORE-267.md`
- `.loom/progress/CORE-267.md`
- `.loom/specs/CORE-267/spec.md`
- `.loom/specs/CORE-267/plan.md`
- `.loom/specs/CORE-267/implementation-contract.md`
- `.loom/specs/CORE-267/evidence-map.md`
- `.loom/specs/CORE-267/task-carrier.md`
- `packages/core/src/lode-admission.ts`
- `packages/core/src/runtime-task-chain.ts`
- `packages/api-server/src/server.ts`
- `packages/api-server/src/runtime-task-submit-self-check.ts`
- `packages/api-server/src/runtime-process-self-check.ts`
