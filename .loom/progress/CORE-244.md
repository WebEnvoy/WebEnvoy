# CORE-244 Progress

## Dynamic Facts

- Item ID: CORE-244
- Current Checkpoint: merge
- Current Stop: PR #252 and PR #253 merged to `main`, covering CORE-244 admission/query compatibility and structured Harbor identity failure semantics. Core #244 remains open because successful live task execution and terminal result/evidence refs still require App/Core/Harbor E2E evidence.
- Next Step: Continue the next real Core runtime batch from `no_active_item`; do not treat #252/#253 as full Core #243/#244 closeout.
- Blockers: None
- Latest Validation Summary: 2026-07-09T03:13Z UTC post-merge carrier retire sync: PR #252 head `c2b941b41fc933d907658fa7da13d2769336fa3b` merged as `7d224396df16b3669d56be268eef60f12c0e805b`; PR #253 head `3fd07579ce242461ad3397224ad8c259e4189679` merged as `b2cf96fd86c4d11c260605d93a9e1797a79c7ec1`. Pre-merge validation for #252 passed Core/API/conformance typecheck and tests plus workspace typecheck; pre-merge validation for #253 passed `pnpm --filter @webenvoy/core-runtime test`, `pnpm --filter @webenvoy/api-server test`, `pnpm typecheck`, `git diff --check`, and cross-repo local API E2E returning `identity_environment_required` without real site/account/profile access. This carrier retire does not claim successful Xiaohongshu/BOSS execution.
- Recovery Boundary: Revert this carrier-retire branch; no App/Harbor/Lode code changes, real account/profile/Cookie/production page action, submit, publish, send, hosted browser, marketplace, bulk collection, or risk-bypass claim occurred.
- Current Lane: Core admission health and capability-runs query compatibility for App #265.

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
- Diagnostics Entry: packages/api-server/src/self-check.ts;packages/core/src/self-check.ts
- Verification Entry: .loom/progress/CORE-244.md
- Lane Entry: .loom/specs/CORE-244/plan.md
