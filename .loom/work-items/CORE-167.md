# CORE-167 Work Item

- Host issue: https://github.com/WebEnvoy/WebEnvoy/issues/167
- Parent FR: https://github.com/WebEnvoy/WebEnvoy/issues/166
- Covered Work Items: #167, #168, #169, #170
- Branch: work/core-167-action-request-risk
- Scope: Stage 6 action request, risk classification, no-submit guard, and conformance fixture.
- Non-goals: approval execution, true writes, post-submit results, unknown outcome, reconciliation, App UI, Lode package truth, Harbor raw/private material.

## Static Facts

- Item ID: CORE-167
- Goal: Provide Core action request, risk classification, no-submit guard, and conformance fixture facts for Stage 6 validate-only, draft, and preview write-precheck flows.
- Scope: Covers Core #167/#168/#169/#170; excludes approval execution, true writes, post-submit results, unknown outcome, reconciliation, App UI, Lode package truth, and Harbor raw/private material.
- Execution Path: work/core-167-action-request-risk
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-167.md
- Review Entry: .loom/reviews/CORE-167.json
- Validation Entry: pnpm --filter @webenvoy/core-runtime test; pnpm --filter @webenvoy/schemas test; pnpm conformance; pnpm typecheck; git diff --check
- Closing Condition: PR #181 merged, #167/#168/#169/#170/#166 closeout evidence posted, and current pointer returned to no_active_item.

## Associated Artifacts

- Story readiness/spec: .loom/specs/CORE-167/spec.md
- Plan: .loom/specs/CORE-167/plan.md
- Implementation contract: .loom/specs/CORE-167/implementation-contract.md
- Evidence map: .loom/specs/CORE-167/evidence-map.md
- Task carrier: .loom/specs/CORE-167/task-carrier.md
- Progress: .loom/progress/CORE-167.md
- Review records: .loom/reviews/CORE-167.spec.json, .loom/reviews/CORE-167.json
