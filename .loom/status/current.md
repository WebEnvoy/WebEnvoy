# Current Status

## Derived Fact Chain View

- Item ID: CORE-244
- Goal: Add Core #244 terminal submit behavior and process-level regression evidence for App task submit/admission/query failures.
- Scope: App-facing Core API Server and Core runtime task chain. The built `dist/index.js` must expose `/admission/health`, return structured degraded readiness when Lode/Harbor are not configured, submit a mock configured read task through local Lode/Harbor contracts, expose run/result/evidence/session/capability refs, and fail closed with a terminal Run Record when Harbor cannot provide a valid same-origin page scene. Ownership is limited to Core/WebEnvoy runtime task chain, API Server self-checks, and CORE-244 Loom carriers.
- Execution Path: work/core-244-terminal-submit-smoke
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-244.md
- Review Entry: .loom/reviews/CORE-244.json
- Validation Entry: pnpm --filter @webenvoy/api-server test; pnpm typecheck; pnpm test; pnpm lint; git diff --check; App packaged runtime smoke with explicit latest Core/Harbor source dirs
- Closing Condition: PR Ready, merge, post-merge closeout comment on #244 documenting this process-smoke evidence without closing final live E2E scope.
- Current Checkpoint: merge
- Current Stop: Branch `work/core-244-terminal-submit-smoke` has local implementation and validation ready for PR. It prevents App-facing read tasks from lingering in `admitted` when Harbor cannot provide a valid same-origin scene, and extends built-process API smoke to cover configured `/tasks` submit plus run/result/evidence/session/capability query refs. This is mock/local contract evidence only; it does not close Core #244/#243 final live E2E scope.
- Next Step: Commit, push, create a CORE-244 PR with machine metadata, run hosted `loom-pr-merge-gate`, then controlled merge only if hosted checks are clean. Keep #244 open until App-driven real task submit/run/result/evidence refs pass the final live E2E boundary.
- Blockers: None
- Latest Validation Summary: 2026-07-09T19:26Z UTC local validation passed on branch `work/core-244-terminal-submit-smoke` before final commit: `pnpm --filter @webenvoy/core-runtime typecheck`, `pnpm --filter @webenvoy/api-server typecheck`, `pnpm --filter @webenvoy/core-runtime test`, `pnpm --filter @webenvoy/api-server test`, `pnpm --filter @webenvoy/api-server build && node packages/api-server/dist/runtime-task-submit-self-check.js`, `pnpm typecheck`, `pnpm test`, `pnpm lint`, `git diff --check`, `loom verify --target . --json`, `loom suite carrier validate --target . --item CORE-244 --json`, `loom suite evidence validate --target . --item CORE-244 --json`, `loom suite validate --target . --item CORE-244 --json`, `loom fact-chain --target . --json`, and `loom build --target . --item CORE-244 --build-evidence .loom/specs/CORE-244/build-evidence.json --json`. Scope: local mock Lode registry and mock Harbor runtime only; no real Xiaohongshu/BOSS account, browser profile, Cookie, production page action, submit, publish, send, hosted browser, marketplace, bulk collection, full account cloud hosting, or risk-control bypass occurred.
- Recovery Boundary: Revert branch `work/core-244-terminal-submit-smoke`; no App/Harbor/Lode code changes, real account/profile/Cookie/production page action, submit, publish, send, hosted browser, marketplace, bulk collection, full account cloud hosting, or risk-bypass claim occurred.
- Current Lane: Core #244 terminal submit and process-level task query smoke PR lane.

## Runtime Evidence

- Run Entry: fixture_local_contract_smoke_no_live_site
- Logs Entry: command output from `pnpm --filter @webenvoy/api-server test`; `pnpm --filter @webenvoy/core-runtime test`; `pnpm --filter @webenvoy/api-server build && node packages/api-server/dist/runtime-task-submit-self-check.js`; `pnpm typecheck`; `pnpm test`; `pnpm lint`; `git diff --check`
- Diagnostics Entry: packages/core/src/runtime-task-chain.ts; packages/api-server/src/runtime-task-submit-self-check.ts; packages/api-server/src/runtime-process-self-check.ts
- Verification Entry: .loom/progress/CORE-244.md
- Lane Entry: .loom/specs/CORE-244/plan.md

## Sources

- Static Truth: .loom/work-items/CORE-244.md
- Dynamic Truth: .loom/progress/CORE-244.md
- Locator Truth: .loom/bootstrap/init-result.json
- Fact Chain CLI: loom fact-chain --target . --json
