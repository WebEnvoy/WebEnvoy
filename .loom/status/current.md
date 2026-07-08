# Current Status

## Derived Fact Chain View

- Item ID: CORE-244
- Goal: Implement Core #243 core runtime task chain compatibility batch anchored on Work Item #244 and covering the App-facing admission/query repair for App #265.
- Scope: App-facing Core API exposes admission health and keeps capability run list queries stable when stale or partial run records exist. Ownership is limited to Core/WebEnvoy API server, run record query paths, focused self-checks, and CORE-244 Loom carriers.
- Execution Path: work/core-244-admission-contract
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-244.md
- Review Entry: .loom/reviews/CORE-244.json
- Validation Entry: pnpm --filter @webenvoy/core-runtime typecheck; pnpm --filter @webenvoy/api-server typecheck; pnpm --filter @webenvoy/core-runtime test; pnpm --filter @webenvoy/api-server test; pnpm --filter @webenvoy/conformance test; pnpm typecheck; git diff --check; loom suite validate/carrier/evidence --target . --item CORE-244 --json
- Closing Condition: PR Ready, merge, post-merge closeout for Core #243/#244 compatibility evidence, and follow-up current pointer retire if required by gate.
- Current Checkpoint: build
- Current Stop: Reopened after 2026-07-09 App E2E No-Go. Prior PR #249/#250/#251 evidence remains valid for the earlier task-chain slice, but App E2E still failed because Core `/admission/health` returned 404 and `/capability-runs?...` returned 500 on stale/partial run records.
- Next Step: Land the Core admission/query compatibility fix, then feed this PR/head into App #265 E2E.
- Blockers: None
- Latest Validation Summary: 2026-07-08T17:21Z UTC main-controller validation passed: `pnpm --filter @webenvoy/core-runtime typecheck`; `pnpm --filter @webenvoy/api-server typecheck`; `pnpm --filter @webenvoy/core-runtime test`; `pnpm --filter @webenvoy/api-server test`; `pnpm --filter @webenvoy/conformance test`; `pnpm typecheck`; `git diff --check`; `loom fact-chain --target . --json`; `loom build --target . --item CORE-244 --build-evidence .loom/specs/CORE-244/build-evidence.json --json`. Deterministic review-readiness evidence was run and classified as repo-local tool surface absent, not product failure: `tools/skills_surface.py check` exit 127; `tools/loom_check.py --profile source --source-surface contract-only` exit 127; `tools/check_release_surface.py` exit 127; `tools/version_surface_check.py` exit 127; `tools/check_npm_package.py` exit 127.
- Recovery Boundary: Revert branch `work/core-244-admission-contract`; no App/Harbor/Lode repository changes, real account/profile/Cookie/production page action, submit, publish, send, hosted browser, marketplace, bulk collection, or risk-bypass claim occurred.
- Current Lane: Core admission health and capability-runs query compatibility for App #265.

## Runtime Evidence

- Run Entry: not_applicable_live_runtime_not_attempted
- Logs Entry: not_applicable
- Diagnostics Entry: packages/api-server/src/self-check.ts;packages/core/src/self-check.ts
- Verification Entry: .loom/progress/CORE-244.md
- Lane Entry: .loom/specs/CORE-244/plan.md

## Sources

- Static Truth: .loom/work-items/CORE-244.md
- Dynamic Truth: .loom/progress/CORE-244.md
- Locator Truth: .loom/bootstrap/init-result.json
- Fact Chain CLI: loom fact-chain --target . --json
