# Current Status

## Derived Fact Chain View

- Item ID: CORE-244
- Goal: Add Core #244 process-level regression evidence for App #265 runtime admission/query failures.
- Scope: App-facing Core API Server process launch. The built `dist/index.js` must expose `/admission/health`, return structured degraded readiness when Lode/Harbor are not configured, and keep `/capability-runs` from returning 500 for empty or invalid App-facing queries. Ownership is limited to Core/WebEnvoy API Server test code and CORE-244 Loom carriers.
- Execution Path: work/core-244-app-admission-e2e
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-244.md
- Review Entry: .loom/reviews/CORE-244.json
- Validation Entry: pnpm --filter @webenvoy/api-server test; pnpm typecheck; pnpm test; pnpm lint; git diff --check; App packaged runtime smoke with explicit latest Core/Harbor source dirs
- Closing Condition: PR Ready, merge, post-merge closeout comment on #244 documenting this process-smoke evidence without closing final live E2E scope.
- Current Checkpoint: merge
- Current Stop: CORE-244 process-level API server regression guard is open as PR #264 at the current PR head; local validation, PR metadata preflight, spec review, code review, and App packaged runtime smoke are complete, and the lane is waiting for hosted `loom-pr-merge-gate` plus controlled merge.
- Next Step: Rerun hosted `loom-pr-merge-gate` for PR #264, then controlled merge and post-merge evidence on #244 without claiming final live App/Core/Harbor E2E completion.
- Blockers: None
- Latest Validation Summary: 2026-07-09T15:20Z local validation passed: `pnpm --filter @webenvoy/api-server test` passed and now includes `dist/runtime-process-self-check.js`, which starts the built API server with `WEBENVOY_RUN_RECORD_DIR`, verifies `/health`, verifies `/admission/health` returns structured degraded owner readiness instead of 404, verifies `/capability-runs?...` returns an empty `webenvoy.capability-run-query.v0` envelope instead of 500, and verifies missing `capability_ref` returns a structured 400. `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `git diff --check` also passed. `loom fact-chain --target . --json`, `loom suite validate --target . --item CORE-244 --json`, `loom suite carrier validate --target . --item CORE-244 --json`, `loom suite evidence validate --target . --item CORE-244 --json`, and PR metadata preflight for PR #264 passed. App packaged runtime smoke passed using latest Core/Harbor source dirs, with no real account/profile/Cookie/production page action. Review-readiness tool classification: `tools/skills_surface.py check` not_applicable because this repository has no repo-local `tools/` directory; `tools/loom_check.py --profile source --source-surface contract-only` not_applicable for the same absent repo-local tools surface and Loom validation is provided by global `loom fact-chain` plus suite validators; `tools/check_release_surface.py` not_applicable because release_judgment is `no_release`; `tools/version_surface_check.py` not_applicable because this PR does not change release/version surfaces; `tools/check_npm_package.py` not_applicable because packages remain private workspaces and no npm publishing surface is changed.
- Recovery Boundary: Revert branch `work/core-244-app-admission-e2e`; no App/Harbor/Lode code changes, real account/profile/Cookie/production page action, submit, publish, send, hosted browser, marketplace, bulk collection, full account cloud hosting, or risk-bypass claim occurred.
- Current Lane: Core API Server process-level admission/query regression guard for App #265.

## Runtime Evidence

- Run Entry: local_process_smoke_no_live_site
- Logs Entry: command output from `pnpm --filter @webenvoy/api-server test`
- Diagnostics Entry: packages/api-server/src/runtime-process-self-check.ts
- Verification Entry: .loom/progress/CORE-244.md
- Lane Entry: .loom/specs/CORE-244/plan.md

## Sources

- Static Truth: .loom/work-items/CORE-244.md
- Dynamic Truth: .loom/progress/CORE-244.md
- Locator Truth: .loom/bootstrap/init-result.json
- Fact Chain CLI: loom fact-chain --target . --json
