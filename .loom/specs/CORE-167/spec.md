# CORE-167 Story Readiness

## Story Readiness

- User value: callers can submit a write-precheck intent and Core records an auditable action request with risk classification while true submit remains blocked.
- Success experience: validate-only/draft/preview requests consume Lode package mode and Harbor writable target facts, create a refs-only Run Record, and include an active no-submit guard.
- Failure states: missing package contract, mismatched operation mode, missing writable target facts, no-submit guard missing, private raw fields, or true write intents fail closed with structured failure records.
- Sensitive data boundary: Core stores refs, summaries, risk, no-submit guard status, and action request metadata only; it does not store credentials, cookies, profile state, raw DOM, raw network, raw evidence, user draft bodies, or Lode package bodies.
- Non-goals: approval execution, cancellation semantics, preview Result Envelope, true writes, reconciliation, App UI, hosted browser, marketplace, hosted sync.
- Dependency facts: Lode PR #191 provides validate-only package/resource/guard facts; Harbor PR #151 provides writable target/form/no-submit guard facts.

## Suite Path

- Suite path: minimal
- Rationale: bounded Stage 6 Core contract spine for action request/risk/no-submit admission and fixtures. Recheck if approval execution, preview result envelopes, write operation refs, true write paths, or private material handling enters scope.
- full-path-artifacts not_applicable rationale: bounded Stage 6 Core action request/risk/no-submit contract slice; consumer boundary: Lode/Harbor/App consume refs, risk, guard status, and schema fixtures only; recheck condition: switch to full suite when adding approval execution, preview Result Envelope, write operation refs, true writes, hosted runtime, or private material handling.
