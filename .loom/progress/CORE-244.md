# CORE-244 Progress

## Dynamic Facts

- Item ID: CORE-244
- Current Checkpoint: build
- Current Stop: CORE-244 process-level API server regression guard implemented on `work/core-244-app-admission-e2e`; PR/review/gate are pending.
- Next Step: Run Loom carrier validation/review, create PR, then use post-merge evidence to update #244 without claiming final live App/Core/Harbor E2E completion.
- Blockers: None
- Latest Validation Summary: 2026-07-09T15:20Z local validation passed: `pnpm --filter @webenvoy/api-server test` passed and now includes `dist/runtime-process-self-check.js`, which starts the built API server with `WEBENVOY_RUN_RECORD_DIR`, verifies `/health`, verifies `/admission/health` returns structured degraded owner readiness instead of 404, verifies `/capability-runs?...` returns an empty `webenvoy.capability-run-query.v0` envelope instead of 500, and verifies missing `capability_ref` returns a structured 400. `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `git diff --check` also passed. `loom fact-chain --target . --json`, `loom suite validate --target . --item CORE-244 --json`, `loom suite carrier validate --target . --item CORE-244 --json`, `loom suite evidence validate --target . --item CORE-244 --json`, and PR metadata preflight for PR #264 passed. App packaged runtime smoke passed using latest Core/Harbor source dirs, with no real account/profile/Cookie/production page action. Review-readiness tool classification: `tools/skills_surface.py check` not_applicable because this repository has no repo-local `tools/` directory; `tools/loom_check.py --profile source --source-surface contract-only` not_applicable for the same absent repo-local tools surface and Loom validation is provided by global `loom fact-chain` plus suite validators; `tools/check_release_surface.py` not_applicable because release_judgment is `no_release`; `tools/version_surface_check.py` not_applicable because this PR does not change release/version surfaces; `tools/check_npm_package.py` not_applicable because packages remain private workspaces and no npm publishing surface is changed.
- Recovery Boundary: Revert branch `work/core-244-app-admission-e2e`; no App/Harbor/Lode code changes, real account/profile/Cookie/production page action, submit, publish, send, hosted browser, marketplace, bulk collection, full account cloud hosting, or risk-bypass claim occurred.
- Current Lane: Core API Server process-level admission/query regression guard for App #265.

## Execution Ledger

- Ledger Binding: recovery_entry
- Plan Locator: .loom/specs/CORE-244/plan.md
- Acceptance Locator: .loom/specs/CORE-244/spec.md
- Validation Evidence Locator: .loom/specs/CORE-244/evidence-map.md
- Handoff Notes Locator: .loom/specs/CORE-244/task-carrier.md
- Evidence Freshness: current

## Runtime Evidence

- Run Entry: not_applicable_live_runtime_not_attempted
- Logs Entry: not_applicable
- Diagnostics Entry: packages/api-server/src/runtime-process-self-check.ts;packages/api-server/src/self-check.ts
- Verification Entry: .loom/progress/CORE-244.md
- Lane Entry: .loom/specs/CORE-244/plan.md
