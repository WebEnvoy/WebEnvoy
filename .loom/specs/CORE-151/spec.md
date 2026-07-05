# Spec

## Goal

- Carry Lode-owned output schema identity in the Core Result Envelope for read capability results.
- Preserve Core as Run Record and Result Envelope truth owner without copying package truth or raw evidence.

## Suite Path

- Suite path: minimal
- full-path-artifacts not_applicable rationale: bounded Stage 5 schema projection slice; consumer boundary: Lode owns output schema identity and Core stores only refs/public projection metadata; recheck condition: switch to full suite when changing terminal outcome semantics, persistence model, or cross-repo schema ownership.

## Scenarios

- Scenario 1: Given a read run completes successfully, Result Envelope includes output_schema_id from the Lode package contract.
- Scenario 2: Given schema fixtures validate, output_schema_id is accepted as a refs-only public projection field.
- Scenario 3: Given post-check is supplied, Run Record and Result Envelope retain the post-check result without raw Harbor evidence.

## Boundaries

- In scope: Result Envelope type/schema/fixture/self-check update.
- Out of scope: Lode package truth, Harbor raw evidence, App UI, Stage 6 writes, terminal outcome taxonomy changes, and new runtime execution.

## Acceptance Criteria

- [x] Result Envelope accepts output_schema_id.
- [x] Core self-check asserts output_schema_id in successful projection.
- [x] Schema fixture includes output_schema_id and passes schema validation.
- [x] Existing post-check and refs-only boundaries continue to pass tests.
