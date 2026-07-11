# CORE-227

## Static Facts

- Item ID: CORE-227
- Goal: Consume Harbor's real BOSS `boss_job_search` read operation and accept only operation-specific, refs-only public results bound to the pinned Lode contract.
- Scope: BOSS query/city dispatch, exact public-summary validation, Lode pin validation, session/control/challenge failure handling, source/evidence ref validation, focused self-checks, and CORE-227 carriers.
- Execution Path: work/core-227-boss-search-real-read
- Workspace Entry: /Volumes/2T/dev/WebEnvoy/.worktrees/WebEnvoy-core-227-boss-search-real-read
- Recovery Entry: .loom/progress/CORE-227.md
- Review Entry: .loom/reviews/CORE-227.json
- Validation Entry: focused Core/API typecheck and tests; full pnpm typecheck/test/lint; git diff checks; Loom suite/fact-chain/build checks
- Closing Condition: Ready PR covers #227 without merge or issue closure.

## Covered Issue

- #227 BOSS job search real read-only consumption.

## Explicitly Not Covered

- BOSS job detail reading (#270), write-precheck, parent FR closeout, or live-account E2E.
- App, Harbor, or Lode changes.
- Login automation, credentials, Cookie/token/profile/raw DOM/HAR/network body/screenshot persistence, writes, messaging, apply actions, or risk-control bypass.

## Ownership Constraints

- Product writes are limited to `packages/core/src/runtime-task-chain.ts`, `packages/api-server/src/runtime-task-submit-self-check.ts`, and only if required `packages/api-server/src/runtime-process-self-check.ts`.
- Governance writes are limited to CORE-227 item-specific carriers plus the serialized shared current/bootstrap pointers.
- Harbor owns runtime/session/probe truth; Lode owns capability and allowlist truth; Core stores only public summaries and opaque refs.

## Associated Artifacts

- `.loom/work-items/CORE-227.md`
- `.loom/progress/CORE-227.md`
- `.loom/specs/CORE-227/spec.md`
- `.loom/specs/CORE-227/plan.md`
- `.loom/specs/CORE-227/implementation-contract.md`
- `.loom/specs/CORE-227/evidence-map.md`
- `.loom/specs/CORE-227/task-carrier.md`
- `.loom/specs/CORE-227/build-evidence.json`
- `packages/core/src/runtime-task-chain.ts`
- `packages/api-server/src/runtime-task-submit-self-check.ts`
