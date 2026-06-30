# Spec

## Goal

Record the minimal Loom / PR / closeout rules that prevent future PRs from reusing `INIT-0001` or shipping with stale head metadata.

## Scope

- In scope: `AGENTS.md` guidance and item-specific Loom carrier for this docs-only governance PR.
- Out of scope: historical carrier migration, product roadmap changes, schema/API/runtime implementation, and workflow changes.

## Required Behavior

- `INIT-0001` is reserved for Loom bootstrap or gate repair.
- Product, planning, boundary, and implementation PRs bind to a real GitHub Work Item and item-specific Loom carrier.
- PR body, carrier, review artifact, and closeout evidence stay bound to the same item/head chain.

## Suite Applicability

- Suite path: not_applicable
- Rationale: This PR changes repository agent guidance and Loom documentation carriers only; no product code, schema, API, runtime, generated facts, fixtures, or user-facing behavior changes.
- Consumer boundary: Applies only to this docs-only governance PR and its current head.
- Recheck condition: Require suite or stronger validation if this PR adds executable code, schema/API/runtime behavior, generated facts, fixtures, or workflow logic.
