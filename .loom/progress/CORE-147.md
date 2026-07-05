# CORE-147 Progress

## Dynamic Facts

- Item ID: CORE-147
- Current Checkpoint: build
- Current Stop: Core capability attribution fixture, schema/runtime/conformance updates, and validation evidence are implemented on PR #160.
- Next Step: Record current-head review, update PR metadata, and run hosted gate for Core #160.
- Blockers: None recorded.
- Latest Validation Summary: pnpm test -- --runInBand, git diff --check, suite validate, suite evidence validate, suite carrier validate, fact-chain, and verify passed on CORE-147.
- Recovery Boundary: Core attribution fixture only; no Lode package body persistence, Harbor raw evidence, App UI state, credential, or Stage 6 write behavior.
- Current Lane: stage5 capability attribution fixture

## Execution Ledger

- Ledger Binding: recovery_entry
- Plan Locator: .loom/specs/CORE-147/plan.md
- Acceptance Locator: .loom/specs/CORE-147/spec.md
- Validation Evidence Locator: .loom/specs/CORE-147/evidence-map.md
- Handoff Notes Locator: .loom/specs/CORE-147/task-carrier.md
- Evidence Freshness: current
