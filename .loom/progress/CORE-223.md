# CORE-223 Progress

## Dynamic Facts

- Item ID: CORE-223
- Current Checkpoint: build
- Current Stop: Core implementation and focused local validation are complete; PR metadata/review/merge-ready remain pending.
- Next Step: Run Loom fact-chain and suite validations, commit, push, create PR, then run pre-review/review/merge-ready.
- Blockers: None
- Latest Validation Summary: 2026-07-09T12:35Z UTC: `pnpm install --frozen-lockfile`, `pnpm exec tsc -p packages/core/tsconfig.json --noEmit`, `pnpm --filter @webenvoy/core-runtime build`, `pnpm exec tsc -p packages/api-server/tsconfig.json --noEmit`, `pnpm --filter @webenvoy/api-server test`, `pnpm --filter @webenvoy/core-runtime test`, `pnpm typecheck`, and `git diff --check` passed. API self-check includes a no-external mock Xiaohongshu Lode package and mock Harbor #234 site-resource facts path; Core calls `/runtime/sessions/{ref}/site-resource-facts?site_id=xiaohongshu&task_kind=search_notes`, succeeds when required facts are available, and fails closed when `page.pinia_store.ready` is unknown.
- Recovery Boundary: Revert this branch. No App/Harbor/Lode code changes, real account/profile/Cookie/production page access, submit, publish, send, save, hosted browser, marketplace, bulk collection, or risk-bypass action occurred. Final product E2E still requires App-driven runtime evidence and user authorization before any real account/profile/production page action.
- Current Lane: Core Harbor #234 site-resource facts admission consumption.

## Execution Ledger

- Ledger Binding: recovery_entry
- Plan Locator: .loom/specs/CORE-223/plan.md
- Acceptance Locator: .loom/specs/CORE-223/spec.md
- Validation Evidence Locator: .loom/specs/CORE-223/build-evidence.json
- Handoff Notes Locator: .loom/specs/CORE-223/task-carrier.md
- Evidence Freshness: current

## Runtime Evidence

- Run Entry: packages/api-server/src/runtime-task-submit-self-check.ts
- Logs Entry: not_applicable
- Diagnostics Entry: packages/core/src/runtime-task-chain.ts
- Verification Entry: .loom/progress/CORE-223.md
- Lane Entry: .loom/specs/CORE-223/plan.md
