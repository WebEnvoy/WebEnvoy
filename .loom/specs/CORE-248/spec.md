# CORE-248 Spec

## Goal

Core turns a successful App/API read-only task submission into a terminal refs-only run result when Lode admission and Harbor runtime admission both succeed.

## Suite Path

- Suite path: minimal
- Path decision: this is a bounded Core-only implementation slice with focused mock Harbor/Lode validation. Full App E2E, live site/account/browser evidence, PR merge-ready, and milestone closeout remain with the main controller.
- contracts.md not_applicable rationale: no new cross-repo field ownership is authored; Core consumes the Harbor/Lode contracts already present in merged Harbor/Lode work and current issues. Consumer boundary: Core PR review only. Recheck condition: require contracts.md if Harbor/Lode payload semantics change.
- readiness-checklist.md not_applicable rationale: readiness is tracked in `.loom/progress/CORE-248.md` and PR validation; final release readiness is App E2E-owned. Consumer boundary: Core PR review only. Recheck condition: require readiness checklist before final product closeout.
- research.md not_applicable rationale: no new research decision is introduced. Consumer boundary: scope verification only. Recheck condition: require research.md if upstream API behavior is uncertain or changes.
- suite-index.md not_applicable rationale: minimal suite artifacts are directly locatable under `.loom/specs/CORE-248/`. Consumer boundary: suite validation and PR review. Recheck condition: require suite-index.md if this becomes a full suite PR lane.

## Scenarios

- S-001 terminal read result: POST `/tasks` with read/read policy, valid Lode package, and valid Harbor scene/evidence refs returns a Run Record with status `succeeded`, result ref, result kind, output schema id, evidence refs, and runtime binding refs.
- S-002 query refs: GET `/runs/{run_id}`, `/runs/{run_id}/result`, `/runs/{run_id}/evidence-refs`, and `/capability-runs` expose terminal result/evidence/session refs.
- S-003 fail closed: Harbor unavailable, malformed, identity-missing, mismatched scene origin, missing scene URL, invalid evidence refs, duplicate run id, invalid run id, or private input still fails closed or stays non-terminal and does not fabricate success.
- S-004 no leakage: Core stores refs, summaries, public page summary, and consumer boundaries only; it does not store raw DOM, HAR, screenshot bodies, cookies, tokens, profile storage, browser endpoints, or production payload.

## Non-Goals

No App UI or packaging change, no Harbor/Lode code change, no real production page or account/profile/Cookie operation, no true write, no submit/publish/send/save, no risk-control bypass, and no final App E2E closeout.
