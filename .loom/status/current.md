# Current Status

## Derived Fact Chain View

- Item ID: CORE-271
- Goal: Terminalize failed Core tasks and release or safely recover their `core_task` Harbor session locks.
- Scope: Core task execution failure finalization, scoped Harbor release/stop cleanup, restart recovery, targeted tests, and CORE-271 item-specific carriers.
- Execution Path: work/core-271-failure-lock-cleanup
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-271.md
- Review Entry: .loom/reviews/CORE-271.json
- Validation Entry: Core/API typecheck and tests, process restart smoke, full repository checks, diff checks, and Loom item checks.
- Closing Condition: Ready PR for #271; no merge or issue closure.
- Current Checkpoint: merge
- Current Stop: Product head `6e3ca53e6bb0358d6d085860fe7cd63b875f6414` passed all targeted/full checks and independent re-review; carrier head binds that review without product drift.
- Next Step: Consume the hosted merge gate and perform controlled merge; keep #271 open until merged-runtime failure cleanup is observed in packaged E2E.
- Blockers: None
- Latest Validation Summary: 2026-07-12T05:14Z: At product head `6e3ca53e6bb0358d6d085860fe7cd63b875f6414`, targeted Core/API tests, `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `git diff --check` passed. Independent re-review confirmed bounded cleanup deadlines, strict final GET proof of closed/idle owner-none released lock with null holder, primary-failure preservation with separate refs-only cleanup post-check, and manual-owner protection. No live account or external write occurred.
- Recovery Boundary: Revert only CORE-271-owned code and carriers. Do not modify App, Harbor, or Lode; do not close #271 before merged-runtime evidence; do not access credentials or perform external writes.
- Current Lane: CORE-271 terminal failure and core_task session-lock cleanup.

## Runtime Evidence

- Run Entry: packaged failure-cleanup replay pending after merge
- Logs Entry: targeted and full pnpm test output
- Diagnostics Entry: packages/core/src/runtime-task-chain.ts; packages/api-server/src/runtime-process-self-check.ts; packages/api-server/src/runtime-task-submit-self-check.ts
- Verification Entry: .loom/specs/CORE-271/build-evidence.json
- Lane Entry: .loom/specs/CORE-271/plan.md

## Sources

- Static Truth: .loom/work-items/CORE-271.md
- Dynamic Truth: .loom/progress/CORE-271.md
- Locator Truth: .loom/bootstrap/init-result.json
- Fact Chain CLI: loom fact-chain --target . --json
