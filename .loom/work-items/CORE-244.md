# CORE-244

## Static Facts

- Item ID: CORE-244
- Goal: Implement Core #243 core runtime task chain compatibility batch anchored on Work Item #244 and covering the App-facing admission/query repair for App #265.
- Scope: App-facing Core API exposes admission health and keeps capability run list queries stable when stale or partial run records exist. Ownership is limited to Core/WebEnvoy API server, run record query paths, focused self-checks, and CORE-244 Loom carriers.
- Execution Path: work/core-244-admission-contract
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-244.md
- Review Entry: .loom/reviews/CORE-244.json
- Validation Entry: pnpm --filter @webenvoy/core-runtime typecheck; pnpm --filter @webenvoy/api-server typecheck; pnpm --filter @webenvoy/core-runtime test; pnpm --filter @webenvoy/api-server test; pnpm --filter @webenvoy/conformance test; pnpm typecheck; git diff --check; loom suite validate/carrier/evidence --target . --item CORE-244 --json
- Closing Condition: PR Ready, merge, post-merge closeout for Core #243/#244 compatibility evidence, and follow-up current pointer retire if required by gate.

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
- Shared `.loom/status/current.md` is intentionally active for CORE-244 in this formal worktree so fact-chain, current-head review, and merge-ready consume the same item. Closeout/retire remains out of scope until after merge.
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
- `packages/core/src/run-record-store.ts`
- `packages/core/src/self-check.ts`
- `packages/core/src/index.ts`
- `packages/api-server/src/server.ts`
- `packages/api-server/src/index.ts`
- `packages/api-server/src/runtime-task-submit-self-check.ts`
- `packages/api-server/src/self-check.ts`
