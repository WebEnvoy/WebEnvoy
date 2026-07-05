# CORE-148 Progress

## Dynamic Facts

- Item ID: CORE-148
- Current Checkpoint: closed_out
- Current Stop: CORE-148 PR #162 is merged and covered issues are closed; this carrier-only PR is retiring the current pointer.
- Next Step: Merge carrier-only closeout PR, then keep Core #151 open for the remaining Lode output schema projection.
- Blockers: None recorded.
- Latest Validation Summary: targeted core/api/schema/conformance tests, conformance smoke, typecheck, lint, git diff --check, suite validate, suite evidence validate, suite carrier validate, fact-chain, and verify passed locally.
- Recovery Boundary: Revert CORE-148 PR to remove Core attribution/query/post-check additions; no raw Harbor evidence, Lode package body, App UI state, or Stage 6 behavior is introduced.
- Current Lane: stage5 Core capability attribution closeout

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

- Merge carrier-only closeout PR and verify current pointer is no_active_item on main.

## Terminal Closeout Metadata

- Terminal State: closed_out
- Issue: 148, 149, 150, 153, 154, 155, 156, 157
- PR: 162
- Merge Commit: 5d1ce537eb602ab496377947a31df956fb7b8d16
- Target Branch: main
- Closed At: 2026-07-05T16:38:23Z
- Evidence Locator: https://github.com/WebEnvoy/WebEnvoy/issues/148;https://github.com/WebEnvoy/WebEnvoy/issues/149;https://github.com/WebEnvoy/WebEnvoy/issues/150;https://github.com/WebEnvoy/WebEnvoy/issues/153;https://github.com/WebEnvoy/WebEnvoy/issues/154;https://github.com/WebEnvoy/WebEnvoy/issues/155;https://github.com/WebEnvoy/WebEnvoy/issues/156;https://github.com/WebEnvoy/WebEnvoy/issues/157;https://github.com/WebEnvoy/WebEnvoy/pull/162
