# CORE-223 Spec

## Goal

Core consumes Harbor #234 site-level runtime facts during App/API task submission and treats Lode required Harbor facts as the admission source of truth for real-site tasks.

## Suite Path

- Suite path: minimal
- Path decision: Core-only implementation slice with no-external mock Harbor/Lode validation. Full App E2E and live account/profile/site evidence remain with App #265 and final milestone closeout.
- contracts.md not_applicable rationale: no new cross-repo field ownership is authored; Core consumes Harbor #234 and Lode resource fact contracts already present in merged upstream work and current issues. Consumer boundary: Core PR review only. Recheck condition: require contracts.md if Harbor/Lode payload semantics change.
- readiness-checklist.md not_applicable rationale: readiness is tracked in `.loom/progress/CORE-223.md`, `.loom/specs/CORE-223/build-evidence.json`, and PR validation; final release readiness is App E2E-owned. Consumer boundary: Core PR review only. Recheck condition: require readiness checklist before final product closeout.
- research.md not_applicable rationale: no new research decision is introduced; upstream behavior is read from current Harbor/Lode issue and source truth. Consumer boundary: scope verification only. Recheck condition: require research.md if upstream API behavior becomes uncertain or changes.
- suite-index.md not_applicable rationale: minimal suite artifacts are directly locatable under `.loom/specs/CORE-223/`. Consumer boundary: suite validation and PR review. Recheck condition: require suite-index.md if this becomes a full suite PR lane.
- Consumer boundary: Core PR review and merge gate only; this evidence does not close App #14/Core #13.
- Recheck condition: require full suite before final product closeout or if Harbor #234/Lode resource fact field semantics change.

## Scenarios

- S-001 Core derives `site_id` and `task_kind` from Xiaohongshu/BOSS Lode package refs.
- S-002 Core calls Harbor `/runtime/sessions/{runtime_session_ref}/site-resource-facts?site_id=...&task_kind=...` after opening the runtime session.
- S-003 Core maps Harbor `harbor-site-resource-facts/v0` entries into `harbor-core-resource-facts/v0` for Lode resource matching.
- S-004 Core succeeds only when required Lode Harbor facts are available.
- S-005 Core fails closed when Harbor reports missing, unknown, blocked, unsupported, or unavailable site facts.
- S-006 Core stores refs/status/failure only and does not persist raw DOM, HAR, screenshots, cookies, tokens, browser endpoints, or profile material.

## Non-Goals

No App UI, Harbor/Lode code changes, real browser/account/profile/Cookie use, production page action, true write, submit, publish, send, hosted browser, marketplace, bulk collection, risk-control bypass, or final milestone closeout.
