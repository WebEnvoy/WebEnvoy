# Spec

## Goal

Define the Stage 2 docs-only Core contract for Result Envelope, Run Record, failure taxonomy, task/run/result query semantics, Admission, resource matching, Action Risk, and validate/draft/preview/true-write boundaries.

## Scope

- In scope: ADR 0003/0004 updates and GH-45 carrier covering Core #44/#45/#46/#47/#48/#49/#50/#51/#52/#53/#54/#55.
- Out of scope: code, JSON Schema, OpenAPI, SDK/CLI/MCP/API implementation, runtime, storage, evidence store, viewer, App UI, merge, and issue closeout.

## Required Behavior

- Result Envelope distinguishes public data, refs, failure, recovery hint, run/result refs, write/reconciliation refs, and raw/evidence/source/resource refs by owner.
- Run Record defines minimum durable fields, terminal states, retention, redaction, and raw runtime material exclusion.
- Failure taxonomy covers request, capability, resource, action risk, runtime, projection, evidence, persistence, and deferred write outcome failures.
- Query semantics distinguish not found, permission denied, expired, redacted, missing, and access denied without rewriting terminal run outcome.
- Admission consumes Lode resource requirements and validator facts, Harbor runtime/page/evidence/viewer facts, caller policy, and action intent.
- Validate-only, draft, preview, and true-write boundaries stay distinct; true-write remains deferred.
- Research and upstream facts are recorded with absorption, trimmed reuse, reference-only, or rejected boundaries.

## Suite Path

- Suite path: minimal
- Full suite artifacts not_applicable: rationale: docs-only ADR and GH-45 item-specific Loom carrier; consumer boundary: ADR readers, GitHub issues #44/#45/#46/#47/#48/#49/#50/#51/#52/#53/#54/#55, downstream App/Core/Harbor/Lode planning, PR metadata, Loom carrier validation, and hosted docs/gate checks; recheck condition: require full suite if executable code, final schemas, generated artifacts, API/runtime behavior, storage, evidence capture, viewer behavior, fixture files, or user-facing behavior are introduced.
