# Spec

## Goal

Freeze the first low-risk read-only Core task wedge and research absorption boundary without writing a full schema or implementation skeleton.

## Scope

- In scope: existing ADR updates for Core #19/#20/#21, linked absorption/non-goal boundaries for #7/#8/#9/#10/#11/#12, and early write-side boundary notes for #22/#23/#24.
- Out of scope: product code, package scaffolding, full JSON Schema, full write-side design, runtime ownership, Lode asset design, Harbor provider implementation, App UI behavior, issue closeout, and merge.

## Required Behavior

- The first user task wedge is a low-risk read-only intent over a user-provided page/account environment.
- Core receives normalized intent, consumes one `capability_ref` and one `runtime_ref`, creates a run record after admission, and returns a result envelope, evidence refs, or structured failure reason.
- Core does not adopt a generic browser agent loop as the formal execution path.
- Syvert and old WebEnvoy mechanisms may be absorbed as boundary patterns; source reuse stays limited to small state/protocol/helper seeds.
- Write-side validate-only/draft/preview may be future inputs; real writes remain deferred until approval, idempotency, post-check, unknown outcome, and reconciliation semantics exist.

## Suite Path

- Suite path: minimal
- Full suite artifacts not_applicable: rationale: this PR changes ADR documentation and item-specific Loom carrier files only; consumer boundary: suite validation, review, merge-ready, and closeout consume the ADR decision tables plus GH-20 carrier; recheck condition: require full suite or stronger validation if this PR adds executable code, schema/API/runtime behavior, generated facts, fixtures, workflow logic, or user-facing behavior.
