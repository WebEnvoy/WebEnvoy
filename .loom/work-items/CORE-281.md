# CORE-281

## Static Facts

- Item ID: CORE-281
- Goal: Fail closed all BOSS production task admission while preserving XHS current runtime admission.
- Scope: Core Lode registry/admission policy consumption, shared task submission gate, focused API/Core regressions, and item-specific carriers.
- Execution Path: work/core-281-boss-admission-disabled
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-281.md
- Review Entry: .loom/reviews/CORE-281.json
- Validation Entry: Core/API targeted checks, full repository checks, diff checks, and Loom item checks.
- Closing Condition: Ready PR for issue #281 with current-head review and hosted checks; no merge or issue closeout.

## Non-Goals

- No Lode, Harbor, or App edits; no production page, browser, account, profile, sensitive material, or external action.
- No BOSS asset deletion and no claim that BOSS runtime is supported or complete.
- Shared `.loom/status/current.md`, merge, and post-merge closeout remain controller-owned.

## Associated Artifacts

- .loom/specs/CORE-281/spec.md
- .loom/specs/CORE-281/plan.md
- .loom/specs/CORE-281/implementation-contract.md
- .loom/specs/CORE-281/evidence-map.md
- .loom/specs/CORE-281/task-carrier.md
- packages/core/src/lode-admission.ts
- packages/core/src/runtime-task-chain.ts
- packages/core/src/self-check.ts
- packages/api-server/src/runtime-task-submit-self-check.ts
