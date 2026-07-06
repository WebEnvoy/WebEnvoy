# CORE-199 Spec

## Goal

Provide App-facing, refs-only query surfaces for real Core runs: result envelope, evidence refs, session refs, and failure reasons with recovery hints.

## Suite Path

- Suite path: full
- Story Readiness locator: https://github.com/WebEnvoy/WebEnvoy/issues/189#issuecomment-4888808258
- Story Business Confirmation locator: https://github.com/WebEnvoy/WebEnvoy/issues/189#issuecomment-4888808258
- Provenance: Consumes FR #189 stories #29/#30 plus Work Items #199/#200/#201/#202.

## Scenarios

- Scenario S-001 evidence refs: Given a terminal real run with Harbor evidence refs, when App queries evidence refs, then Core returns ref, source, recorded_at, retention/redaction state, runtime_session_ref, and raw_access=`not_available_from_core`.
- Scenario S-002 session refs: Given a run bound to Harbor public session facts, when App queries session refs, then Core returns runtime/profile/provider/identity refs and session state without raw endpoints, cookies, tokens, profile storage, or raw evidence.
- Scenario S-003 failure reasons: Given a failed or blocked run, when App queries failure reason, then Core returns a machine-readable reason_class, failure code, recovery_hint/app_action, retryable flag, and evidence refs for login-required, page-changed, field-unavailable, and risk-prompt cases.
- Scenario S-004 API consumption: Given App uses the API Server, when it requests `/runs/:id`, `/runs/:id/result`, `/runs/:id/evidence-refs`, `/runs/:id/session-refs`, or `/runs/:id/failure`, then it can render run facts without reading Core file storage.

## Boundaries

- In scope: Core runtime query helpers, API GET routes, schema fixtures, conformance/self-checks, Loom carriers, PR metadata.
- Out of scope: #190/#203-#206, App UI, Harbor/Lode/App code, live account operation, true writes, captcha/risk bypass, raw evidence download, raw DOM/HAR/network/screenshot/video, CDP/VNC/websocket endpoints, cookies, tokens, profile storage, Lode package body or validator code.

## Acceptance Criteria

- [x] A result/evidence query returns public result/evidence refs and state without raw material.
- [x] A session refs query returns Harbor public session/profile/provider/identity refs only.
- [x] A failure reason query classifies login-required, page-changed, field-unavailable, and risk-prompt failures with App-consumable recovery actions.
- [x] API routes expose the query surfaces with not_found/invalid run_id failures.
- [x] Schema fixtures document new session refs and failure reason query envelopes.
- [x] Conformance consumes real-site fixtures through the new query surfaces.
