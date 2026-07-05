# Spec

## Goal

- Accept read-only capability source and lock refs on Core task intent attribution.
- Preserve capability ref/version/source/lock metadata in Core-owned run/query/result fixtures without storing Lode package bodies or Harbor raw evidence.

## Suite Path

- Suite path: minimal
- full-path-artifacts not_applicable rationale: this PR is a narrow Core attribution contract/fixture slice; consumer boundary: suite validation, review, merge-ready, and closeout consume spec.md, plan.md, evidence-map.md, and task-carrier.md only; recheck condition: switch to full suite when this branch changes admission ownership, runtime execution, persistence format beyond attribution fields, or cross-repo contract ownership.

## Scenarios

- Scenario 1: Given a read-only task intent with capability source and lock refs, when Core validates admission fixtures, then the refs remain attached to capability attribution.
- Scenario 2: Given a stored run record/result envelope, when consumers query it, then capability ref/version/source/lock metadata is visible without package body, raw evidence, or App UI state.

## Boundaries

- In scope: schema/runtime/conformance fixture attribution for read-only capability refs.
- Out of scope: submit route expansion, Stage 6 write behavior, Lode package body persistence, Harbor raw evidence, and App local UI state.

## Acceptance Criteria

- [x] Core accepts optional capability source and lock refs in task intent fixtures.
- [x] Run record/query/result fixture boundaries keep attribution separate from package/runtime truth.
- [x] Conformance fixtures cover the new attribution fields.
