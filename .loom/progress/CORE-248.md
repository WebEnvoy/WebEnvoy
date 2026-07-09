# CORE-248 Progress

## Dynamic Facts

- Item ID: CORE-248
- Current Checkpoint: build
- Current Stop: Corrective implementation is open as PR #257: `verifyEvidenceRefs` now requires each Harbor evidence lookup response to match the requested `evidence_ref` and report `access_state: available`, with self-check coverage for invalid scene URLs plus malformed and mismatched evidence lookup responses failing closed without copied `evidence_refs`. The PR body metadata is the canonical head carrier and must be refreshed after each review/carrier commit.
- Next Step: Refresh current-head review and gate inputs for PR #257, run merge gates, then keep Core #243/App #265 open for App-driven live E2E.
- Blockers: None recorded.
- Latest Validation Summary: 2026-07-09T08:26Z UTC: implementation validation remained green from 2026-07-09T08:04Z UTC: `pnpm install --frozen-lockfile`, `pnpm exec tsc -p packages/core/tsconfig.json --noEmit`, `pnpm exec tsc -p packages/api-server/tsconfig.json --noEmit`, `pnpm --filter @webenvoy/core-runtime test`, `pnpm --filter @webenvoy/api-server test`, `pnpm typecheck`, `git diff --check`, `loom fact-chain --target . --json`, `loom suite carrier validate --target . --item CORE-248 --json`, `loom suite evidence validate --target . --item CORE-248 --json`, `loom suite validate --target . --item CORE-248 --json`, and `loom build --target . --item CORE-248 --build-evidence .loom/specs/CORE-248/build-evidence.json --json` passed. API self-check covers invalid scene URL staying admitted/non-terminal, malformed and mismatched Harbor evidence lookup responses returning `evidence_unavailable`, failed run status, and no copied `evidence_refs`. Deterministic review-readiness evidence: `tools/skills_surface.py check` is not present in this repo; equivalent `loom skills check --target . --json` returned block on pre-existing `.loom/bootstrap` repo-local payload residue and is classified as Loom tool-surface blocker, not Core product behavior. `tools/loom_check.py --profile source --source-surface contract-only` is not present in this repo; hosted `loom-check` passed for PR #257 run 29003866515 and local `loom verify --target . --json` passed. `tools/check_release_surface.py`, `tools/version_surface_check.py`, and `tools/check_npm_package.py` are not present in this repo; global `loom skills release-check --target . --json` returned block on Loom release/runtime-copy surfaces outside this no-release Core PR, while `loom installed-state validate --target . --json`, `loom version --json`, `loom doctor --target . --json`, and `loom host doctor --host codex --scope user --json` passed. `loom pre-review --target . --item CORE-248 --json` previously blocked before this update because the latest validation summary lacked those deterministic readiness entries. No App/Harbor/Lode code changed and no real browser/account/profile/Cookie/production page action occurred.
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
