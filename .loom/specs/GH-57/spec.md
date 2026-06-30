# Spec

## Goal

Define docs-only common task submission semantics for API, CLI, MCP, SDK, and App entry projections, aligned with ADR 0005 Task Intent Envelope / Run lifecycle v0.

## Scope

- In scope: ADR contract for GH-56/GH-57/GH-58/GH-59/GH-60; minimal fixture shape and conformance checklist; item-specific GH-57 Loom carrier.
- Out of scope: API route implementation, CLI command implementation, MCP server/tool implementation, SDK generation, final JSON Schema, fixture files, conformance runner, runtime executor, hosted merge-ready, merge, and issue closeout.

## Required Behavior

- Every entrypoint projects into the same Task Intent Envelope field families from ADR 0005.
- `entrypoint` identifies source only; it cannot change task, run, result, failure, cancel, or retry semantics.
- API, CLI, MCP, SDK, and App are limited to submit/query/cancel/retry for this v0 contract.
- Fixture definitions describe purpose and JSON field shape only; they do not create executable fixtures in this PR.
- Research absorption decisions are recorded in the ADR, including absorbed, trimmed, referenced-only, and rejected mechanisms.

## Suite Path

- Suite path: minimal
- Full suite artifacts not_applicable: rationale: docs-only contract ADR and GH-57 item-specific Loom carrier; consumer boundary: ADR readers, GitHub issues #56/#57/#58/#59/#60, App #36/#57 downstream planning, PR metadata, Loom carrier validation, and hosted docs/gate checks; recheck condition: require full suite or stronger validation if this PR adds executable code, final schemas, fixture files, generated artifacts, API/runtime behavior, workflow logic, or user-facing behavior.
