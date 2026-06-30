# Spec

## Goal

Define Core reference and version ownership semantics for capability, package, runtime, evidence, source, resource, caller, run, and result refs.

## Scope

- In scope: docs-only ADR 0007 and GH-42 carrier covering Core #41/#42/#43.
- Out of scope: JSON Schema, OpenAPI, SDK/CLI/MCP/API implementation, storage, registry, runtime, evidence store, viewer/handoff, App UI, merge, and issue closeout.

## Required Behavior

- Core records refs and summaries, not upstream raw truth.
- Lode owns capability/package/schema/resource/post-check versions.
- Harbor owns runtime/profile/identity/session/evidence/source facts.
- Core owns run/result/caller/entrypoint refs and failure mapping.
- Missing, expired, unavailable, unauthorized, redacted, incompatible, and invalid_contract states must remain distinguishable.
- Historical Run Records keep the refs used at run time; later upstream changes do not silently rewrite history.

## Suite Path

- Suite path: minimal
- Full suite artifacts not_applicable: rationale: docs-only ADR and GH-42 item-specific Loom carrier; consumer boundary: ADR readers, GitHub issues #41/#42/#43, downstream App/Core/Harbor/Lode planning, PR metadata, Loom carrier validation, and hosted docs/gate checks; recheck condition: require full suite if executable code, final schemas, generated artifacts, API/runtime behavior, evidence storage, fixture files, or user-facing behavior are introduced.
