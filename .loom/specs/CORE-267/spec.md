# CORE-267 Spec

## Goal

Core resolves the Lode runtime allowlist, submits an explicit public read query to Harbor's managed session operation endpoint, and creates a succeeded Run Record only from a completed response whose pin, source refs, evidence refs, and post-check satisfy Lode requirements.

## Scenarios

- S-001 allowlist truth: resolve the selected Lode package/lock/operation and validate origin, failure taxonomy, required source/evidence ref kinds, and post-check fields.
- S-002 operation execution: after runtime admission, call `POST /runtime/sessions/{session_ref}/read-operations` with the validated site/operation, explicit non-empty query, and optional canonical HTTPS URL.
- S-003 validated success: only Harbor `status=completed` with matching Lode pin and all required public refs/post-check fields may produce a succeeded run/result.
- S-004 terminal failure: unavailable, contract drift, missing refs, or post-check mismatch produces an explicit terminal failure or unknown outcome and never falls back to snapshot success.
- S-005 refs-only persistence: store public summary and opaque operation/source/evidence/result/session refs, never sensitive or raw browser/page material.

## Non-Goals

No new Core endpoint family, no Harbor/Lode/App mutation, no automatic login, no write action, no bulk collection, and no live-story closeout from fixtures or contract smoke.

