# CORE-244

## Static Facts

- Item ID: CORE-244
- Goal: Implement Core #243 core runtime task chain batch anchored on Work Item #244 and covering #244/#245/#246/#247/#248.
- Scope: App-facing Core API accepts a read-only task request, resolves Lode capability metadata/resource requirements from a local registry asset, calls Harbor local runtime API readiness/provider/session/snapshot/evidence endpoints, writes Run Record admission/failure facts, and returns evidence/runtime refs without claiming live task success. Ownership is limited to Core/WebEnvoy API server, Core runtime clients/orchestration, focused self-checks, and CORE-244 Loom carriers.
- Execution Path: work/core-244-runtime-task-chain
- Workspace Entry: /Volumes/2T/dev/WebEnvoy/WebEnvoy.worktrees/core-244-runtime-task-chain
- Recovery Entry: .loom/progress/CORE-244.md
- Review Entry: .loom/reviews/CORE-244.json
- Validation Entry: pnpm --filter @webenvoy/core-runtime typecheck; pnpm --filter @webenvoy/api-server typecheck; pnpm --filter @webenvoy/core-runtime test; pnpm --filter @webenvoy/api-server test; git diff --check; loom suite validate/carrier/evidence --target . --item CORE-244 --json
- Closing Condition: PR Ready, merge, post-merge closeout for #243/#244/#245/#246/#247/#248, and follow-up current pointer retire if required by gate.

## Covered Issues

- #244 submit/admission API.
- #245 Lode capability metadata/resource requirements parsing.
- #246 Harbor runtime session/evidence API client.
- #247 Run Record lifecycle admission/failure write.
- #248 result/evidence/failure refs returned through submit response and existing query endpoints.

## Explicitly Not Covered

- App, Harbor, or Lode code changes.
- Real Xiaohongshu/BOSS page access, real accounts, profile/Cookie import, external visible action, publish/send/submit, hosted browser, marketplace, bulk collection, or risk bypass.
- Lode runtime runner behavior; Lode remains asset/registry source only.
- PR creation, push, merge-ready, issue closeout, or milestone closeout.

## Ownership Constraints

- Writes limited to Core/WebEnvoy API server, Core runtime clients/orchestration, run record admission paths, focused self-checks, and CORE-244 Loom carriers.
- Shared `.loom/status/current.md` remains `no_active_item`; this worker does not claim the shared current pointer.
- No subagent output was used or left unintegrated.

## Associated Artifacts

- `.loom/work-items/CORE-244.md`
- `.loom/progress/CORE-244.md`
- `.loom/specs/CORE-244/spec.md`
- `.loom/specs/CORE-244/plan.md`
- `.loom/specs/CORE-244/implementation-contract.md`
- `.loom/specs/CORE-244/evidence-map.md`
- `.loom/specs/CORE-244/task-carrier.md`
- `.loom/specs/CORE-244/build-evidence.json`
- `packages/core/src/runtime-task-chain.ts`
- `packages/core/src/task-submission.ts`
- `packages/core/src/index.ts`
- `packages/api-server/src/server.ts`
- `packages/api-server/src/index.ts`
- `packages/api-server/src/runtime-task-submit-self-check.ts`
- `packages/api-server/src/self-check.ts`
