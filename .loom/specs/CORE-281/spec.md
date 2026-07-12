# CORE-281 Spec

## Goal

Consume Lode merge `f45b17990a6b1451a7a0ff55ec110c310e66f196` production admission truth so BOSS search, detail, and greet-precheck fail closed before Harbor while XHS stays current.

## Suite Path

- Suite path: minimal
- full-path-artifacts not_applicable rationale: this is a bounded Core consumer of the merged Lode #273 policy with focused runtime/API tests; consumer boundary: suite validation, semantic review, and PR readiness consume spec.md, plan.md, evidence-map.md, task-carrier.md, implementation-contract.md, and executable checks only; recheck condition: require contracts.md, readiness-checklist.md, research.md, and suite-index.md if Core changes the Lode-owned shape, restores BOSS production scope, accesses external runtime state, or expands beyond this admission gate.

## Acceptance

- BOSS search, detail, and greet-precheck return `capability_contract/runtime_admission_disabled` with recovery `wait_for_scope_activation`.
- The failed run is terminal with `blocked_pre_admission`, no result/evidence success, and zero Harbor calls.
- App/API/CLI/MCP/SDK intents and direct Core submission share the same gate.
- Registry and operation policies must be exact, known, and equal; missing, malformed, or drifted policies fail closed.
- XHS current policy remains admitted; enabled BOSS behavior exists only in explicitly test-only temporary fixtures.

## Non-Goals

No external runtime access, BOSS usability claim, taxonomy category expansion, asset removal, or cross-repository edit.
