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
- Current Checkpoint: merge
- Current Stop: Current-head review and PR metadata are recorded; ready to run PR gate and merge-ready for Core #244 compatibility PR.
- Next Step: Run PR gate and merge-ready, then merge Core #252 after Harbor #231.
- Blockers: None
- Latest Validation Summary: 2026-07-08T17:56Z UTC main-controller carrier validation passed after CORE-244 review drift fix: `git diff --check`; `loom fact-chain --target . --json`; `loom suite carrier validate --target . --item CORE-244 --json`; `loom suite evidence validate --target . --item CORE-244 --json`; `loom build --target . --item CORE-244 --build-evidence .loom/specs/CORE-244/build-evidence.json --json`. Product-code validation from 2026-07-08T17:21Z remains unchanged and passed: Core/API/conformance typecheck and tests plus workspace typecheck. No real account, Cookie, browser profile import, production page action, submit, publish, send, or external visible action was performed.
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
