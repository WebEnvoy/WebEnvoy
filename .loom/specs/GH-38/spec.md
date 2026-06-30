# Spec

## Goal

Define Task Intent Envelope v0, Run lifecycle/status vocabulary v0, and pre-admission failure / Run Record creation rules for Stage 2 Core FR #37.

## Scope

- In scope: docs-only ADR contract covering GH-38, GH-39, and GH-40; item-specific Loom carrier for GH-38.
- Out of scope: API route implementation, runtime executor, SDK/MCP/CLI code, final JSON Schema, database schema, hosted merge-ready, merge, and issue closeout.

## Required Behavior

- App, API, CLI, MCP, and SDK share one Task Intent Envelope through API Server normalization.
- Core v0 public states are `pending`, `admitted`, `running`, `succeeded`, `failed`, `cancelled`, and `expired`.
- Requests that cannot form a trusted Task Intent Envelope do not create durable Run Records.
- Trusted Task Intent Envelopes create a Run Record at `pending`; admission failures after that point become terminal `failed` Run Records.
- The contract records research absorption decisions for the issue body locators.

## Suite Path

- Suite path: minimal
- Full suite artifacts not_applicable: rationale: this PR changes docs and item-specific Loom carrier only; consumer boundary: ADR readers, planning issues, PR metadata, Loom carrier validation, and hosted docs/gate checks; recheck condition: require full suite or stronger validation if this PR adds executable code, final schemas, API/runtime behavior, generated artifacts, fixtures, workflow logic, or user-facing behavior.

