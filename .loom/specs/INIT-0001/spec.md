# Spec

## Goal

Use a temporary bootstrap-bound docs-only gate for the Core boundary documentation PR.

## Scope

- In scope: review the Core boundary documentation semantics in PR #30.
- Out of scope: Phase 2 schema/API/runtime implementation, product code, generated facts, and cross-repo runtime behavior.

## Boundary Statement

Core documents that WebEnvoy consumes refs, facts, and intent, while Harbor, Lode, and App own their respective runtime/capability/UI facts.

## Validation

- Review changed ADR and pending-decision documents only.
- Confirm no product code or test fixture files changed.
- Confirm PR metadata binds `Loom Work Item: INIT-0001`, branch, and head SHA.

## Suite Applicability

- Suite path: not_applicable
- Artifact: suite-level
- Rationale: This PR changes only boundary documentation and does not change executable code, schemas, APIs, runtime behavior, or tests.
- Consumer boundary: This N/A applies only to Core PR #30 boundary documentation semantics at the current PR head; it does not approve Phase 2 implementation.
- Recheck condition: Require suite/test validation if code, schema, API, runtime behavior, generated facts, or fixture contracts change.
