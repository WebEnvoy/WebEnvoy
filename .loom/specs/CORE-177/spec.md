# CORE-177 Story Readiness

## Story Readiness

- User value: callers can inspect a validate-only/preview Result Envelope with expected change, evidence refs, action refs, and capability version without mistaking it for a submitted result.
- Success experience: Core persists and queries preview result projection with `submitted: false`, Lode capability/version/package refs, Harbor evidence refs, and failure classes for preview unavailable, page changed, and user cancelled.
- Failure states: preview unavailable, page changed, user cancelled, missing evidence refs, missing action request ref, or invalid expected change projection.
- Sensitive data boundary: Core stores refs, public expected change summaries, failure class, and submitted=false only; it does not store raw Harbor evidence, credentials, cookies, profile state, raw DOM/network, draft bodies, submitted results, or Lode package bodies.
- Non-goals: approval execution, true write execution, submitted result, unknown outcome, reconciliation, post-submit result, App UI, hosted browser, marketplace, hosted sync.
- Dependency facts: Lode #181/#186 expected change/fixture facts and Harbor #141/#146 evidence/no-submit facts are merged and consumed as refs/status facts only.

## Suite Path

- Suite path: minimal
- full-path-artifacts not_applicable rationale: bounded Stage 6 Core preview Result Envelope contract slice; consumer boundary: App consumes preview/action/evidence/capability refs and submitted=false only; recheck condition: switch to full suite when adding approval execution, submitted results, true writes, reconciliation, hosted runtime, or private material handling.
