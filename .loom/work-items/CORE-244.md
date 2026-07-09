# CORE-244

## Static Facts

- Item ID: CORE-244
- Goal: Add Core #244 process-level regression evidence for App #265 runtime admission/query failures.
- Scope: App-facing Core API Server process launch. The built `dist/index.js` must expose `/admission/health`, return structured degraded readiness when Lode/Harbor are not configured, and keep `/capability-runs` from returning 500 for empty or invalid App-facing queries. Ownership is limited to Core/WebEnvoy API Server test code and CORE-244 Loom carriers.
- Execution Path: work/core-244-app-admission-e2e
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-244.md
- Review Entry: .loom/reviews/CORE-244.json
- Validation Entry: pnpm --filter @webenvoy/api-server test; pnpm typecheck; pnpm test; pnpm lint; git diff --check; App packaged runtime smoke with explicit latest Core/Harbor source dirs
- Closing Condition: PR Ready, merge, post-merge closeout comment on #244 documenting this process-smoke evidence without closing final live E2E scope.

## Covered Issues

- #244 submit/admission API.

This batch is evidence consumed by parent #243 and App #265, but it does not close #225/#226/#227/#228/#230 or the final App E2E story.

## Explicitly Not Covered

- App, Harbor, or Lode code changes.
- Real Xiaohongshu/BOSS page access, real accounts, profile/Cookie import, external visible action, publish/send/submit, hosted browser, marketplace, bulk collection, or risk bypass.
- Lode runtime runner behavior; Lode remains asset/registry source only.
- PR creation, push, merge-ready, issue closeout, or milestone closeout.
- Real App/Computer Use production-page E2E; this remains gated by explicit allowed/forbidden actions.

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
- `packages/api-server/src/runtime-process-self-check.ts`
- `packages/api-server/src/self-check.ts`
