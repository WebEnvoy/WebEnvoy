# CORE-203 Spec

## Goal

Generate refs-only Core write-preview records from real-page Xiaohongshu and BOSS write-precheck inputs while preserving no-submit semantics.

## Suite Path

- Suite path: full
- Story Readiness locator: https://github.com/WebEnvoy/WebEnvoy/issues/190#issuecomment-4888808449
- Story Business Confirmation locator: https://github.com/WebEnvoy/WebEnvoy/issues/190#issuecomment-4888808449
- Provenance: Consumes FR #190 stories #32/#33 plus Work Items #203/#204/#205/#206.

## Scenarios

- Scenario S-001 write-precheck request: Given Xiaohongshu draft or BOSS greeting real-page write-precheck input, when Core records the run, then it distinguishes the site capability, operation mode, target refs, runtime refs, and evidence refs.
- Scenario S-002 action and approval: Given accepted write-precheck input, when Core records action review data, then it stores action_request, risk classification, no-submit guard, and approval_request refs without executing approval or submit.
- Scenario S-003 preview result: Given a valid write-precheck preview, when Core projects the result, then it records preview_result.state=available, expected_change, evidence_refs, result_kind=validate_only_preview through query, and submitted=false.
- Scenario S-004 invalidated preview: Given cancellation, approval expiry, or page change, when Core records terminal state, then cancellation, expired, and page_changed states stay explicit and never become submitted success.

## Boundaries

- In scope: Core schema fixtures, conformance queries, documentation updates, Loom carriers, PR metadata.
- Out of scope: App UI, App/Harbor/Lode code changes, live account operation, external visible action, true write, submitted result, Stage 7, reconciliation, unknown outcome, automatic retry, captcha/risk bypass, cookies, tokens, passwords, profile storage, raw DOM, raw network, raw evidence body, screenshots/videos as bodies, CDP/VNC/websocket endpoints, Lode package body or validator code.

## Acceptance Criteria

- [x] Xiaohongshu draft and BOSS greeting write-preview records are represented with distinct capability/package/resource refs.
- [x] Action request, risk classification, no-submit guard, and approval request are recorded.
- [x] Preview query returns submitted=false and no submitted_result field.
- [x] Cancelled, expired, and page_changed states are queryable without ambiguous success.
- [x] Schema and conformance checks cover the real-page write-preview fixtures.
