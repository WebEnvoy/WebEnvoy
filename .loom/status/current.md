# Current Status

## Derived Fact Chain View

- Item ID: CORE-244
- Goal: Keep Core #244 App task submit/admission compatible with Harbor public identity records and snapshot/evidence availability for the packaged App/Core/Harbor readonly smoke.
- Scope: Core runtime task chain consumes Harbor public identity records and updates snapshot/evidence availability after a successful Harbor snapshot. Ownership is limited to Core/WebEnvoy runtime task chain, API server self-check, and CORE-244 Loom carriers.
- Execution Path: work/core-244-harbor-site-facts-run
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-244.md
- Review Entry: .loom/reviews/CORE-244.json
- Validation Entry: pnpm --filter @webenvoy/api-server test; pnpm typecheck; pnpm test; pnpm lint; git diff --check; App packaged runtime smoke with explicit latest Core/Harbor source dirs
- Closing Condition: PR Ready, merge, post-merge closeout comment on #244 documenting this process-smoke evidence without closing final live E2E scope.
- Current Checkpoint: merge
- Current Stop: Branch `work/core-244-harbor-site-facts-run` is open as PR #265 at head `348dd191408df260612261b7a19e7cdb375747e7`. It lets Core consume Harbor public identity records and update snapshot/evidence availability after successful snapshot verification. This is fixture/local contract evidence only; it does not close Core #244/#243 final live E2E scope.
- Next Step: Rerun hosted `loom-pr-merge-gate` for PR #265 after this current-head review carrier sync, then controlled merge only if hosted checks are clean. Keep #244 open until App-driven real task submit/run/result/evidence refs pass the final E2E boundary.
- Blockers: None
- Latest Validation Summary: 2026-07-09T17:18Z UTC local validation passed for PR #265 branch `work/core-244-harbor-site-facts-run` at head `348dd191408df260612261b7a19e7cdb375747e7`: `pnpm --filter @webenvoy/api-server test`, `pnpm --filter @webenvoy/core-runtime test`, and `git diff --check`. Cross-repo App smoke also passed from the App worktree with `WEBENVOY_CORE_RUNTIME_SOURCE_DIR=/Volumes/2T/dev/WebEnvoy/WebEnvoy.worktrees/core-244-harbor-site-facts-run WEBENVOY_HARBOR_RUNTIME_SOURCE_DIR=/Volumes/2T/dev/WebEnvoy/Harbor.worktrees/harbor-218-fixture-site-facts npm run smoke:packaged:readonly`. Scope: Core consumes Harbor public identity records and updates snapshot/evidence availability after successful snapshot under fixture/local smoke only; no real Xiaohongshu/BOSS account, browser profile, Cookie, production page action, submit, publish, send, hosted browser, marketplace, bulk collection, full account cloud hosting, or risk-control bypass occurred.
- Recovery Boundary: Revert branch `work/core-244-harbor-site-facts-run`; no App/Harbor/Lode code changes, real account/profile/Cookie/production page action, submit, publish, send, hosted browser, marketplace, bulk collection, full account cloud hosting, or risk-bypass claim occurred.
- Current Lane: Core #244 Harbor public identity and snapshot availability current-head carrier sync for PR #265.

## Runtime Evidence

- Run Entry: fixture_local_contract_smoke_no_live_site
- Logs Entry: command output from `pnpm --filter @webenvoy/api-server test`; `pnpm --filter @webenvoy/core-runtime test`; App `smoke:packaged:readonly`
- Diagnostics Entry: packages/core/src/runtime-task-chain.ts; packages/api-server/src/runtime-task-submit-self-check.ts
- Verification Entry: .loom/progress/CORE-244.md
- Lane Entry: .loom/specs/CORE-244/plan.md

## Sources

- Static Truth: .loom/work-items/CORE-244.md
- Dynamic Truth: .loom/progress/CORE-244.md
- Locator Truth: .loom/bootstrap/init-result.json
- Fact Chain CLI: loom fact-chain --target . --json
