# CORE-267 Spec

## Goal

Core resolves the Lode runtime allowlist, submits an explicit public read query to Harbor's managed session operation endpoint, and creates a succeeded Run Record only from a completed response whose pin, source refs, evidence refs, and post-check satisfy Lode requirements.

## Suite Path

- Suite path: minimal
- Path decision: this is a bounded Core-only implementation with focused Harbor/Lode contract and process validation. Merged App live E2E and final issue closeout remain outside this PR.
- contracts.md not_applicable rationale: Core consumes merged Harbor #245 and Lode #262 contracts without changing their ownership or fields. Consumer boundary: CORE-267 review. Recheck condition: require contracts.md if upstream payload semantics change.
- readiness-checklist.md not_applicable rationale: readiness is tracked in `.loom/progress/CORE-267.md`; live product readiness remains App E2E-owned. Consumer boundary: Core PR review. Recheck condition: require before final product closeout.
- research.md not_applicable rationale: upstream contracts and issue acceptance are already authoritative. Consumer boundary: scope verification. Recheck condition: require if upstream behavior becomes uncertain.
- suite-index.md not_applicable rationale: minimal artifacts are directly locatable under `.loom/specs/CORE-267/`. Consumer boundary: suite validation and review. Recheck condition: require if this lane becomes full-suite.

## Scenarios

- S-001 allowlist truth: resolve the selected Lode package/lock/operation and validate origin, failure taxonomy, required source/evidence ref kinds, and post-check fields.
- S-002 operation execution: after runtime admission, call `POST /runtime/sessions/{session_ref}/read-operations` with the validated site/operation, explicit non-empty query, and optional canonical HTTPS URL.
- S-003 validated success: only Harbor `status=completed` with matching Lode pin and all required public refs/post-check fields may produce a succeeded run/result.
- S-004 terminal failure: unavailable, contract drift, missing refs, or post-check mismatch produces an explicit terminal failure or unknown outcome and never falls back to snapshot success.
- S-005 refs-only persistence: store public summary and opaque operation/source/evidence/result/session refs, never sensitive or raw browser/page material.

## Non-Goals

No new Core endpoint family, no Harbor/Lode/App mutation, no automatic login, no write action, no bulk collection, and no live-story closeout from fixtures or contract smoke.
