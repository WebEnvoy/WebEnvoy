# CORE-248

## Static Facts

- Item ID: CORE-248
- Goal: Complete the Core #248 terminal read-only result/evidence refs slice after successful App-facing task submission, Lode package resolution, and Harbor runtime admission.
- Scope: Core/WebEnvoy only. POST `/tasks` may complete a read-only run to a terminal refs-only result when Harbor returns valid scene/evidence refs. Query endpoints must expose run/result/evidence/session refs without raw browser material. Ownership is limited to Core runtime task-chain code, focused API self-checks, and CORE-248 carriers.
- Execution Path: work/core-248-terminal-read-result
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-248.md
- Review Entry: .loom/reviews/CORE-248.json
- Validation Entry: pnpm --filter @webenvoy/core-runtime typecheck; pnpm --filter @webenvoy/api-server typecheck; pnpm --filter @webenvoy/core-runtime test; pnpm --filter @webenvoy/api-server test; pnpm typecheck; git diff --check; loom suite validate/carrier/evidence --target . --item CORE-248 --json
- Closing Condition: PR ready, merge, post-merge closeout for Core #248 and covered Core runtime result/evidence refs, with App E2E left open until App consumes the API.

## Covered Issues

- #248 return result/evidence/failure refs.
- #244 submit/admission API terminal success behavior for read-only runs.
- #243 Core runtime chain evidence needed by App #265.

## Explicitly Not Covered

- App, Harbor, or Lode code changes.
- Real Xiaohongshu/BOSS page access, real accounts, browser profile/Cookie import, or production page operation.
- True write, submit, publish, send, save, hosted browser, marketplace, bulk collection, or risk-control bypass.
- Site-specific Lode runtime normalizer execution; this slice stores a Core refs-only Harbor scene projection.
- App packaged runtime UX, Computer Use E2E, issue/milestone closeout beyond the Core PR evidence.

## Ownership Constraints

- Writes limited to Core runtime task chain, API server focused self-checks, and CORE-248 Loom carriers.
- Shared `.loom/status/current.md` is active for CORE-248 only in this formal worktree.
- Subagent output was read-only and used only as planning context; no subagent edits were integrated.

## Associated Artifacts

- `.loom/work-items/CORE-248.md`
- `.loom/progress/CORE-248.md`
- `.loom/specs/CORE-248/spec.md`
- `.loom/specs/CORE-248/plan.md`
- `.loom/specs/CORE-248/evidence-map.md`
- `.loom/specs/CORE-248/task-carrier.md`
- `.loom/specs/CORE-248/build-evidence.json`
- `packages/core/src/runtime-task-chain.ts`
- `packages/api-server/src/runtime-task-submit-self-check.ts`
