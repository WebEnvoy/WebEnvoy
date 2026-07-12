# CORE-271

## Static Facts

- Item ID: CORE-271
- Goal: Terminalize failed Core tasks and release or safely recover their `core_task` Harbor session locks.
- Scope: Core task execution failure finalization, scoped Harbor release/stop cleanup, restart recovery, targeted tests, and CORE-271 item-specific carriers.
- Execution Path: work/core-271-failure-lock-cleanup
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-271.md
- Review Entry: .loom/reviews/CORE-271.json
- Validation Entry: Core/API typecheck and tests, process restart smoke, full repository checks, diff checks, and Loom item checks.
- Closing Condition: Ready PR for #271; no merge or issue closure.

## Explicitly Not Covered

- App, Harbor, or Lode changes; live browser/account/page activity; login automation; true writes; bulk collection; or risk-control bypass.
- Shared `.loom/status/current.md` ownership, merge, closeout, or parent #243 closure.

## Ownership Constraints

- Product writes: `packages/core/src/runtime-task-chain.ts`, `packages/core/src/index.ts`, `packages/api-server/src/index.ts`, and targeted API self-checks only.
- Governance writes: CORE-271 item-specific carriers only.
- Recovery may release only a public Harbor lock whose owner is `core_task` and holder ref exactly matches the Core run id.
