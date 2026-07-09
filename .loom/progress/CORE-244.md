# CORE-244 Progress

## Dynamic Facts

- Item ID: CORE-244
- Current Checkpoint: merge
- Current Stop: Branch `work/core-244-terminal-submit-smoke` has local implementation and validation ready for PR. It prevents App-facing read tasks from lingering in `admitted` when Harbor cannot provide a valid same-origin scene, and extends built-process API smoke to cover configured `/tasks` submit plus run/result/evidence/session/capability query refs. This is mock/local contract evidence only; it does not close Core #244/#243 final live E2E scope.
- Next Step: Commit, push, create a CORE-244 PR with machine metadata, run hosted `loom-pr-merge-gate`, then controlled merge only if hosted checks are clean. Keep #244 open until App-driven real task submit/run/result/evidence refs pass the final live E2E boundary.
- Blockers: None
- Latest Validation Summary: 2026-07-09T19:26Z UTC local validation passed on branch `work/core-244-terminal-submit-smoke` before final commit: `pnpm --filter @webenvoy/core-runtime typecheck`, `pnpm --filter @webenvoy/api-server typecheck`, `pnpm --filter @webenvoy/core-runtime test`, `pnpm --filter @webenvoy/api-server test`, `pnpm --filter @webenvoy/api-server build && node packages/api-server/dist/runtime-task-submit-self-check.js`, `pnpm typecheck`, `pnpm test`, `pnpm lint`, `git diff --check`, `loom verify --target . --json`, `loom suite carrier validate --target . --item CORE-244 --json`, `loom suite evidence validate --target . --item CORE-244 --json`, `loom suite validate --target . --item CORE-244 --json`, `loom fact-chain --target . --json`, and `loom build --target . --item CORE-244 --build-evidence .loom/specs/CORE-244/build-evidence.json --json`. Scope: local mock Lode registry and mock Harbor runtime only; no real Xiaohongshu/BOSS account, browser profile, Cookie, production page action, submit, publish, send, hosted browser, marketplace, bulk collection, full account cloud hosting, or risk-control bypass occurred.
- Recovery Boundary: Revert branch `work/core-244-terminal-submit-smoke`; no App/Harbor/Lode code changes, real account/profile/Cookie/production page action, submit, publish, send, hosted browser, marketplace, bulk collection, full account cloud hosting, or risk-bypass claim occurred.
- Current Lane: Core #244 terminal submit and process-level task query smoke PR lane.

## Execution Ledger

- Ledger Binding: recovery_entry
- Plan Locator: .loom/specs/CORE-244/plan.md
- Acceptance Locator: .loom/specs/CORE-244/spec.md
- Validation Evidence Locator: .loom/specs/CORE-244/evidence-map.md
- Handoff Notes Locator: .loom/specs/CORE-244/task-carrier.md
- Evidence Freshness: current

## Runtime Evidence

- Run Entry: fixture_local_contract_smoke_no_live_site
- Logs Entry: command output from `pnpm --filter @webenvoy/api-server test`; `pnpm --filter @webenvoy/core-runtime test`; `pnpm --filter @webenvoy/api-server build && node packages/api-server/dist/runtime-task-submit-self-check.js`; `pnpm typecheck`; `pnpm test`; `pnpm lint`; `git diff --check`
- Diagnostics Entry: packages/core/src/runtime-task-chain.ts; packages/api-server/src/runtime-task-submit-self-check.ts; packages/api-server/src/runtime-process-self-check.ts
- Verification Entry: .loom/progress/CORE-244.md
- Lane Entry: .loom/specs/CORE-244/plan.md
