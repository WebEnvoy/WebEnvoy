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

## Suite Path

- Suite path: minimal
- Full suite artifacts not_applicable: rationale: this PR changes repository agent guidance and Loom documentation carriers only; consumer boundary: suite validation, review, merge-ready, and closeout consume only `AGENTS.md` guidance plus item-specific carrier files; recheck condition: require full suite or stronger validation if this PR adds executable code, schema/API/runtime behavior, generated facts, fixtures, workflow logic, or user-facing behavior.
