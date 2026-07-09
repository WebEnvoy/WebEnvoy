# Current Status

## Derived Fact Chain View

- Item ID: CORE-223
- Goal: Consume Harbor #234 site-resource facts in Core runtime admission so App-submitted real-site read-only tasks fail closed unless Harbor public runtime facts satisfy Lode resource requirements.
- Scope: Core/WebEnvoy ownership only. This batch adds Core HTTP client calls to Harbor `/runtime/sessions/{runtime_session_ref}/site-resource-facts`, maps Harbor site facts into Core resource admission facts, preserves existing snapshot/evidence-ref verification, and extends API self-checks with a no-external Xiaohongshu package path.
- Execution Path: work/core-223-harbor-site-facts
- Workspace Entry: /Volumes/2T/dev/WebEnvoy/.worktrees/WebEnvoy-core-223-harbor-site-facts
- Recovery Entry: .loom/progress/CORE-223.md
- Review Entry: .loom/reviews/CORE-223.json
- Validation Entry: pnpm exec tsc -p packages/core/tsconfig.json --noEmit; pnpm --filter @webenvoy/core-runtime build; pnpm exec tsc -p packages/api-server/tsconfig.json --noEmit; pnpm --filter @webenvoy/api-server test; pnpm --filter @webenvoy/core-runtime test; pnpm typecheck; git diff --check; loom fact-chain/suite/carrier/evidence after carrier creation.
- Closing Condition: PR ready, merge, post-merge closeout for Core #223/#243 resource admission evidence, without closing final App E2E issues until App-driven live runtime evidence exists.
- Current Checkpoint: build
- Current Stop: Core implementation and focused local validation are complete; PR metadata/review/merge-ready remain pending.
- Next Step: Run Loom fact-chain and suite validations, commit, push, create PR, then run pre-review/review/merge-ready.
- Blockers: None
- Latest Validation Summary: 2026-07-09T12:54Z UTC: implementation validation remained green after review cleanup removed out-of-scope write-precheck runtime calls from CORE-223. `pnpm install --frozen-lockfile`, `pnpm exec tsc -p packages/core/tsconfig.json --noEmit`, `pnpm --filter @webenvoy/core-runtime build`, `pnpm exec tsc -p packages/api-server/tsconfig.json --noEmit`, `pnpm --filter @webenvoy/api-server test`, `pnpm --filter @webenvoy/core-runtime test`, `pnpm typecheck`, `git diff --check`, `loom fact-chain --target . --json`, `loom suite validate --target . --item CORE-223 --json`, `loom suite carrier validate --target . --item CORE-223 --json`, `loom suite evidence validate --target . --item CORE-223 --json`, `loom checkpoint build --target . --item CORE-223 --json`, and `loom build --target . --item CORE-223 --build-evidence .loom/specs/CORE-223/build-evidence.json --json` passed. API self-check includes a no-external mock Xiaohongshu Lode package and mock Harbor #234 site-resource facts path; Core calls `/runtime/sessions/{ref}/site-resource-facts?site_id=xiaohongshu&task_kind=search_notes`, succeeds when required facts are available, and fails closed when `page.pinia_store.ready` is unknown. Deterministic review-readiness evidence: `tools/skills_surface.py check` is not present in this repo; equivalent `loom skills check --target . --json` returned block on pre-existing `.loom/bootstrap` repo-local payload residue and is classified as Loom tool-surface blocker, not Core product behavior. `tools/loom_check.py --profile source --source-surface contract-only` is not present in this repo; hosted `loom-check` passed for PR #262 run 29019230310 and local `loom verify --target . --json` passed. `tools/check_release_surface.py`, `tools/version_surface_check.py`, and `tools/check_npm_package.py` are not present in this repo; global `loom skills release-check --target . --json` returned block on Loom release/runtime-copy surfaces outside this no-release Core PR, while `loom installed-state validate --target . --json`, `loom version --json`, `loom doctor --target . --json`, and `loom host doctor --host codex --scope user --json` passed. No App/Harbor/Lode code changed and no real browser/account/profile/Cookie/production page action occurred.
- Recovery Boundary: Revert this branch. No App/Harbor/Lode code changes, real account/profile/Cookie/production page access, submit, publish, send, save, hosted browser, marketplace, bulk collection, or risk-bypass action occurred. Final product E2E still requires App-driven runtime evidence and user authorization before any real account/profile/production page action.
- Current Lane: Core Harbor #234 site-resource facts admission consumption.

## Runtime Evidence

- Run Entry: packages/api-server/src/runtime-task-submit-self-check.ts
- Logs Entry: not_applicable
- Diagnostics Entry: packages/core/src/runtime-task-chain.ts
- Verification Entry: .loom/progress/CORE-223.md
- Lane Entry: .loom/specs/CORE-223/plan.md

## Sources

- Static Truth: .loom/work-items/CORE-223.md
- Dynamic Truth: .loom/progress/CORE-223.md
- Locator Truth: .loom/bootstrap/init-result.json
- Fact Chain CLI: loom fact-chain --target . --json
