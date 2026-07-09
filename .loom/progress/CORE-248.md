# CORE-248 Progress

## Dynamic Facts

- Item ID: CORE-248
- Current Checkpoint: build
- Current Stop: Corrective implementation is integrated in the worktree: `verifyEvidenceRefs` now requires each Harbor evidence lookup response to match the requested `evidence_ref` and report `access_state: available`, with self-check coverage for invalid scene URLs plus malformed and mismatched evidence lookup responses failing closed without copied `evidence_refs`.
- Next Step: Create PR for Core #248, run current-head review and merge gates, then keep Core #243/App #265 open for App-driven live E2E.
- Blockers: None recorded.
- Latest Validation Summary: 2026-07-09T08:04Z UTC: `pnpm install --frozen-lockfile`, `pnpm exec tsc -p packages/core/tsconfig.json --noEmit`, `pnpm exec tsc -p packages/api-server/tsconfig.json --noEmit`, `pnpm --filter @webenvoy/core-runtime test`, `pnpm --filter @webenvoy/api-server test`, `pnpm typecheck`, `git diff --check`, `loom fact-chain --target . --json`, `loom suite carrier validate --target . --item CORE-248 --json`, `loom suite evidence validate --target . --item CORE-248 --json`, `loom suite validate --target . --item CORE-248 --json`, and `loom build --target . --item CORE-248 --build-evidence .loom/specs/CORE-248/build-evidence.json --json` passed. API self-check now covers invalid scene URL staying admitted/non-terminal, malformed and mismatched Harbor evidence lookup responses returning `evidence_unavailable`, failed run status, and no copied `evidence_refs`. Subagent implementation output was integrated and verified by the main controller, then the main controller added invalid scene URL coverage. No App/Harbor/Lode code changed and no real browser/account/profile/Cookie/production page action occurred.
- Recovery Boundary: Revert this corrective branch. No App/Harbor/Lode code changes, real account/profile/Cookie/production page access, submit, publish, send, save, hosted browser, marketplace, bulk collection, or risk-bypass action may occur in this batch. App E2E remains blocked until App submits through this API and user authorizes any real account/profile/production page action.
- Current Lane: Core #248 corrective evidence-ref validation.

## Execution Ledger

- Ledger Binding: recovery_entry
- Plan Locator: .loom/specs/CORE-248/plan.md
- Acceptance Locator: .loom/specs/CORE-248/spec.md
- Validation Evidence Locator: .loom/specs/CORE-248/build-evidence.json
- Handoff Notes Locator: .loom/work-items/CORE-248.md
- Evidence Freshness: current

## Runtime Evidence

- Run Entry: packages/api-server/src/runtime-task-submit-self-check.ts
- Logs Entry: not_applicable
- Diagnostics Entry: packages/core/src/runtime-task-chain.ts
- Verification Entry: .loom/progress/CORE-248.md
- Lane Entry: .loom/specs/CORE-248/plan.md

## Previous Terminal Closeout Metadata

- Terminal State: superseded_by_reopen
- Issue: 248
- PR: 255
- Merge Commit: 65c6a3989d12112ddb536e5ad9a58c1fe7d5ac19
- Target Branch: main
- Closed At: 2026-07-09T05:49:06Z
- Evidence Locator: https://github.com/WebEnvoy/WebEnvoy/issues/248;https://github.com/WebEnvoy/WebEnvoy/pull/255
