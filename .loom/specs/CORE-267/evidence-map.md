# CORE-267 Evidence Map

| Evidence ID | Evidence Type | Source Locator | Consumes | Binding | Freshness | Consumer Boundary | Remediation Direction |
|---|---|---|---|---|---|---|---|
| EV-001 | issue_tree_evidence | https://github.com/WebEnvoy/WebEnvoy/issues/267 | #267 acceptance and #243 parent binding | CORE-267 scope | 2026-07-11 | planning/review | Re-read before PR and closeout. |
| EV-002 | upstream_contract | https://github.com/WebEnvoy/Harbor/pull/249 | Harbor merged read-operation endpoint at `2f112b4` | operation consumer | 2026-07-11 | contract/implementation only | Supplement with merged-runtime live evidence. |
| EV-003 | upstream_asset | https://github.com/WebEnvoy/Lode/issues/262 | Lode runtime-consumption allowlist at `e36a4a7` | capability truth | 2026-07-11 | asset consumption | Recheck canonical commit before packaging E2E. |
| EV-004 | behavior_evidence | .loom/specs/CORE-267/spec.md | S-001 through S-005 | CORE-267 acceptance | current | review | Refresh after scope change. |
| EV-005 | implementation_evidence | packages/core/src/runtime-task-chain.ts packages/core/src/lode-admission.ts packages/api-server/src/server.ts | operation invocation, validation, refs-only projection | implementation | pending | current branch | Rerun validation after changes. |
| EV-006 | test_evidence | packages/api-server/src/runtime-task-submit-self-check.ts packages/api-server/src/runtime-process-self-check.ts | success and fail-closed regressions | contract smoke | pending | not live evidence | Supplement with App-driven live evidence. |
| EV-007 | live_runtime_evidence | .loom/progress/CORE-267.md | merged heads plus identity/session/run/result/evidence refs | final closeout | pending | authorized single read-only E2E | Keep #267 open until present. |
| EV-008 | non_goal_evidence | .loom/work-items/CORE-267.md | prohibited actions and excluded repos | safety boundary | current | all phases | Stop if boundary changes. |

