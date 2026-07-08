# CORE-244 Progress

## Dynamic Facts

- Item ID: CORE-244
- Current Checkpoint: merge
- Current Stop: Current-head review and PR metadata are recorded; ready to run PR gate and merge-ready for Core #244 compatibility PR.
- Next Step: Run PR gate and merge-ready, then merge Core #252 after Harbor #231.
- Blockers: None
- Latest Validation Summary: 2026-07-08T17:56Z UTC main-controller carrier validation passed after CORE-244 review drift fix: `git diff --check`; `loom fact-chain --target . --json`; `loom suite carrier validate --target . --item CORE-244 --json`; `loom suite evidence validate --target . --item CORE-244 --json`; `loom build --target . --item CORE-244 --build-evidence .loom/specs/CORE-244/build-evidence.json --json`. Product-code validation from 2026-07-08T17:21Z remains unchanged and passed: Core/API/conformance typecheck and tests plus workspace typecheck. No real account, Cookie, browser profile import, production page action, submit, publish, send, or external visible action was performed.
- Recovery Boundary: Revert branch `work/core-244-admission-contract`; no App/Harbor/Lode repository changes, real account/profile/Cookie/production page action, submit, publish, send, hosted browser, marketplace, bulk collection, or risk-bypass claim occurred.
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
