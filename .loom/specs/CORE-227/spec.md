# CORE-227 Spec

## Goal

Core accepts the bounded App-facing BOSS query/city/page/limit shape, dispatches the public query and city to Harbor, then succeeds only when the completed response exactly matches the BOSS operation-specific public-summary, Lode pin, session, boundary, source/evidence ref, and post-check contracts.

## Suite Path

- Suite path: minimal
- This is a bounded Core consumer correction with focused contract/process checks and no upstream contract mutation.
- Full cross-repo and live-account E2E remain outside this PR.
- contracts.md not_applicable rationale: Harbor `387265eb` and Lode `e36a4a7` remain the authoritative contracts; this consumer-only change does not introduce or alter a shared contract. Consumer boundary: CORE-227 implementation review. Recheck condition: require `contracts.md` if Core changes upstream-owned fields, schemas, pins, or cross-repository ownership.
- readiness-checklist.md not_applicable rationale: bounded readiness is recorded in `.loom/progress/CORE-227.md` and the executable validation plan; product/live readiness is explicitly excluded. Consumer boundary: CORE-227 PR readiness. Recheck condition: require `readiness-checklist.md` if live-account E2E, release, merge, or issue closeout enters scope.
- research.md not_applicable rationale: the merged Harbor implementation, pinned Lode assets, and issue acceptance are sufficient authoritative inputs; no unresolved mechanism research remains. Consumer boundary: CORE-227 scope and semantic review. Recheck condition: require `research.md` if upstream behavior becomes ambiguous or new external source analysis is needed.
- suite-index.md not_applicable rationale: the minimal suite artifacts are directly located under `.loom/specs/CORE-227/` and no full-suite artifact graph is needed. Consumer boundary: Loom suite validation and CORE-227 review. Recheck condition: require `suite-index.md` if governance escalates to a full suite or additional artifact groups are introduced.

## Scenarios

- S-001 BOSS input/success: accept exact `query/city_code/page=1/limit<=15`, dispatch exact query/city, and accept the pinned BOSS result/surface/signals with positive business code shape and refs-only evidence.
- S-002 parser boundary: reject unknown BOSS fields, missing/invalid city, page drift, limit drift, query over 80 characters, and any BOSS-only field on XHS/non-BOSS input.
- S-003 summary trust boundary: reject XHS/arbitrary result kind, wrong surface, query/city drift, extra fields, duplicate/extra/unknown signals, and invalid business/job counts.
- S-004 pin/session/control/challenge: reject Lode pin drift and any invalid runtime session, control owner, or safety challenge before operation consumption.
- S-005 refs/post-check: reject missing, duplicate, extra, reused, or unknown source/evidence ref kinds and post-check drift.
- S-006 unknown outcome/privacy: preserve terminal unknown outcome when Harbor dispatch has no trustworthy response and persist only the validated public summary and opaque refs.

## Non-Goals

No job detail (#270), write-precheck, parent FR closeout, live-account E2E, cross-repo change, or issue merge/closure.
