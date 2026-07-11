# CORE-267 Progress

## Dynamic Facts

- Item ID: CORE-267
- Current Checkpoint: merge
- Current Stop: PR #269 is open at head f114990c455a16e669bdd9e930992bd2aea17b88. Pinned operation identity, exact refs, supervisor bearer action coverage, and core_task ownership are implemented and locally validated.
- Next Step: Record delta review, consume hosted checks, and merge only after required gates pass. Keep #267 open pending merged-head packaged-App live evidence.
- Blockers: None
- Latest Validation Summary: 2026-07-11 at f114990c455a16e669bdd9e930992bd2aea17b88: focused Core/API and root `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `git diff --check` passed. Branch packaged-App live run app-xiaohongshu-mrgcpit5 succeeded through the supervised Harbor session and pinned Lode package; merged-head replay is pending.
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
