# CORE-271 Progress

## Dynamic Facts

- Item ID: CORE-271
- Current Checkpoint: merge
- Current Stop: Product head `6e3ca53e6bb0358d6d085860fe7cd63b875f6414` passed all targeted/full checks and independent re-review; carrier head binds that review without product drift.
- Next Step: Consume the hosted merge gate and perform controlled merge; keep #271 open until merged-runtime failure cleanup is observed in packaged E2E.
- Blockers: None
- Latest Validation Summary: 2026-07-12T05:14Z: At product head `6e3ca53e6bb0358d6d085860fe7cd63b875f6414`, targeted Core/API tests, `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `git diff --check` passed. Independent re-review confirmed bounded cleanup deadlines, strict final GET proof of closed/idle owner-none released lock with null holder, primary-failure preservation with separate refs-only cleanup post-check, and manual-owner protection. No live account or external write occurred.
- Recovery Boundary: Revert only CORE-271-owned code and carriers. Do not modify App, Harbor, or Lode; do not close #271 before merged-runtime evidence; do not access credentials or perform external writes.
- Current Lane: CORE-271 terminal failure and core_task session-lock cleanup.

## Execution Ledger

- Ledger Binding: recovery_entry
- Plan Locator: .loom/specs/CORE-271/plan.md
- Acceptance Locator: .loom/specs/CORE-271/spec.md
- Validation Evidence Locator: .loom/specs/CORE-271/build-evidence.json
- Handoff Notes Locator: .loom/specs/CORE-271/task-carrier.md
- Evidence Freshness: current
