# CORE-148 Progress

## Dynamic Facts

- Item ID: CORE-148
- Current Checkpoint: implemented
- Current Stop: Local implementation and targeted validation are complete; final Loom gates and PR are pending.
- Next Step: Commit, bind review head, push PR, consume hosted gate, then close covered issues with post-merge evidence.
- Blockers: None recorded.
- Latest Validation Summary: targeted core/api/schema/conformance tests, conformance smoke, typecheck, lint, git diff --check, suite validate, and suite carrier validate passed locally; suite evidence/fact-chain are being refreshed.
- Recovery Boundary: Revert CORE-148 PR to remove Core attribution/query/post-check additions; no raw Harbor evidence, Lode package body, App UI state, or Stage 6 behavior is introduced.
- Current Lane: stage5 Core capability attribution

## Execution Ledger

- Ledger Binding: recovery_entry
- Plan Locator: .loom/specs/CORE-148/plan.md
- Acceptance Locator: .loom/specs/CORE-148/spec.md
- Validation Evidence Locator: .loom/specs/CORE-148/evidence-map.md
- Handoff Notes Locator: .loom/specs/CORE-148/task-carrier.md
- Evidence Freshness: current

## Completed

- Added capability lifecycle admission failure mapping for broken/deprecated/suspected_broken Lode refs.
- Added failure attribution categories: capability, input, runtime, site, evidence, unknown.
- Added post-check refs-only summary on Run Record and Result Envelope.
- Added capability-level recent run/failure query and API route.
- Added evidence refs capability version/source/package association.
- Added schemas and fixtures for capability run query and failure post-check attribution.

## Validation

- `pnpm --filter @webenvoy/core-runtime test` passed.
- `pnpm --filter @webenvoy/api-server test` passed.
- `pnpm --filter @webenvoy/schemas test` passed.
- `pnpm --filter @webenvoy/conformance test` passed.
- `pnpm --filter @webenvoy/conformance smoke` passed.
- `pnpm typecheck` passed.

## Remaining

- Run final lint, diff check, Loom suite/carrier/fact-chain/verify, PR metadata preflight, hosted gate.
