# CORE-267 Progress

## Dynamic Facts

- Item ID: CORE-267
- Current Checkpoint: merge
- Current Stop: Implementation and independent semantic review are complete. Allowlisted tasks can succeed only from a Lode-pinned, session-bound Harbor completed operation; unavailable and indeterminate outcomes fail closed without snapshot-success fallback. P0/P1/P2 findings are resolved. A P3 advisory remains to move duplicated trust-boundary parsing and exact contract fixtures into a focused module when a shared schema is available.
- Next Step: Run hosted checks against the review-bound PR head and merge only after all required gates pass. Keep #267 open pending merged-runtime App live evidence.
- Blockers: None
- Latest Validation Summary: 2026-07-11 UTC current worktree passed focused Core/API typecheck, tests, API build/self-check/process-self-check, root `pnpm typecheck`, `pnpm test`, `pnpm lint`, `git diff --check`, and `loom fact-chain`. Independent review found no remaining P0/P1/P2 issues after the `unknown_outcome` HTTP status fix. Evidence is contract/mock validation only; no live site completion is claimed.
- Recovery Boundary: Revert branch `work/core-267-harbor-read-operation`; no App/Harbor/Lode mutation, automatic login, sensitive material access, submit/publish/send, bulk collection, hosted browser, account cloud hosting, or risk bypass is permitted.
- Current Lane: Core #267 Harbor allowlisted read-operation consumption.

## Execution Ledger

- Ledger Binding: recovery_entry
- Plan Locator: .loom/specs/CORE-267/plan.md
- Acceptance Locator: .loom/specs/CORE-267/spec.md
- Validation Evidence Locator: .loom/specs/CORE-267/evidence-map.md
- Handoff Notes Locator: .loom/specs/CORE-267/task-carrier.md
- Evidence Freshness: current

## Runtime Evidence

- Run Entry: contract_smoke_passed_live_e2e_pending
- Logs Entry: command output from focused Core/API checks, root `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `git diff --check`
- Diagnostics Entry: packages/core/src/runtime-task-chain.ts; packages/core/src/lode-admission.ts; packages/api-server/src/server.ts
- Verification Entry: .loom/progress/CORE-267.md
- Lane Entry: .loom/specs/CORE-267/plan.md
