# Spec

## Goal

Close out WebEnvoy Core document drafts for the current docs milestone without changing product semantics or adding code.

## Scope

- In scope: `docs/` directory semantics for `adr/`, `contracts/`, and `draft/`; `docs/draft/README.md` lifecycle rules; inventory of all current draft files; short pointers from promoted draft content to accepted ADR/contract sources; GH-71 Loom carrier.
- Out of scope: code scaffolding, final JSON Schema, API/runtime behavior, generated artifacts, fixtures, `docs/guides/`, merge, and issue closeout.

## Required Behavior

- Every `docs/draft/*.md` input is classified in the inventory table with file, current use, status, target location, linked issue, and action.
- Status vocabulary for this closeout is `promoted`, `pending`, `deferred`, and `removed`.
- Promoted contracts point to accepted ADRs or the contract index instead of keeping duplicate long-form draft truth.
- Pending or deferred drafts, if any remain, include owner, linked issue, and exit condition.
- Obsolete or duplicate drafts are deleted or reduced to short pointers.

## Suite Path

- Suite path: minimal
- Full suite artifacts not_applicable: rationale: docs-only closeout and GH-71 item-specific Loom carrier; no code, final schema, API, runtime behavior, generated facts, fixtures, migrations, or user-facing runtime behavior.
- Consumer boundary: documentation readers, GitHub issues #69/#70/#71/#72/#73, PR metadata, GH-71 Loom carrier, local docs/gate checks, and hosted checks.
- Recheck condition: require stronger validation if this PR or a follow-up PR adds code, final schema, API/runtime behavior, generated facts, fixtures, workflow logic, migrations, or behavior changes.
