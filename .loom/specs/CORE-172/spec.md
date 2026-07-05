# CORE-172 Story Readiness

## Story Readiness

- User value: callers can see whether approval is pending, expired, blocked, or cancelled without interpreting it as a submitted result.
- Success experience: Core persists approval request records, cancellation Run Records, and a query summary tied to an existing action request.
- Failure states: approval expired, user cancelled, approval blocked by policy or stale facts, action request missing, or query has no matching records.
- Sensitive data boundary: Core stores refs, timestamps, status, risk, and summaries only; it does not store credentials, cookies, profile state, raw evidence, draft bodies, or Lode package bodies.
- Non-goals: approval execution, true writes, submitted result, unknown outcome, reconciliation, App UI, hosted browser, marketplace, hosted sync.
- Dependency facts: Core #166 action request/risk classification is merged and consumed as the action request source shape.

## Suite Path

- Suite path: minimal
- full-path-artifacts not_applicable rationale: bounded Stage 6 Core approval/cancellation contract slice; consumer boundary: App consumes approval/cancellation state and refs only; recheck condition: switch to full suite when adding approval execution, submitted results, true writes, reconciliation, hosted runtime, or private material handling.
