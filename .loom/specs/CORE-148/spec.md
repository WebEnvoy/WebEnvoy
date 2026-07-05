# Spec CORE-148

## User Value

App can show whether a read-only capability run used the selected capability version, what failed, who owns the fix path, and which evidence refs support the state without exposing private runtime material.

## Success Experience

- A task run records capability ref/version/source/lock/package refs.
- Querying a run returns failure attribution and post-check summary when terminal.
- Querying a capability returns recent runs, status counts, latest failure, failure attribution counts, and post-check summary.
- Evidence ref query includes capability ref/version/source/package linkage.

## Suite Path

- Suite path: minimal
- full-path-artifacts not_applicable rationale: this PR is a focused Core contract/runtime/schema slice for Stage 5 read-only attribution; consumer boundary: suite validation, review, merge-ready, and closeout consume spec.md, plan.md, evidence-map.md, and task-carrier.md only; recheck condition: switch to full suite if the branch expands into persistence migrations, Harbor runtime ownership, Lode package truth, App UI, or Stage 6 write behavior.

## Failure States

- Missing or malformed task input is attributed to `input`.
- Broken, deprecated, suspected-broken, incompatible, or invalid package contracts are attributed to `capability`.
- Runtime/session/provider blockers are attributed to `runtime`.
- Site-shape change codes are attributed to `site`.
- Snapshot/refmap/evidence freshness or capture blockers are attributed to `evidence`.

## Sensitive Data Boundary

Core returns refs and public summaries only. It must not store or return raw DOM, HAR, screenshot/video bodies, cookies, tokens, profile storage, viewer URLs, CDP endpoints, Harbor runtime internals, Lode package bodies, App UI state, or user business data.

## Non-goals

- No #151 Lode output schema projection.
- No App UI implementation.
- No Harbor evidence storage or viewer implementation.
- No Lode repair draft/package truth implementation.
- No Stage 6 write-side behavior.
