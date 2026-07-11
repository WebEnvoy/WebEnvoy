# CORE-267 Evidence Map

| Evidence ID | Evidence Type | Source Locator | Consumes | Binding | Freshness | Consumer Boundary | Remediation Direction |
|---|---|---|---|---|---|---|---|
| EV-001 | issue_tree_evidence | https://github.com/WebEnvoy/WebEnvoy/issues/267 https://github.com/WebEnvoy/WebEnvoy/issues/243 | #267 acceptance and #243 parent binding | CORE-267 scope | present | planning/review only | Re-read before PR and closeout. |
| EV-002 | behavior_evidence | .loom/specs/CORE-267/spec.md | S-001 through S-005 | CORE-267 acceptance | present | review | Refresh after scope change. |
| EV-003 | implementation_evidence | packages/core/src/runtime-task-chain.ts packages/core/src/lode-admission.ts packages/api-server/src/server.ts | pinned operation invocation, validation, refs-only projection, unknown outcome | CORE-267 implementation | present | Core runtime/API only | Rerun checks after changes. |
| EV-004 | test_evidence | packages/api-server/src/runtime-task-submit-self-check.ts | XHS/BOSS completed responses, unavailable/drift/missing refs, unknown outcome, and query privacy | CORE-267 validation | present | Contract/process smoke only; not live evidence | Supplement with merged App live evidence. |
| EV-005 | validation_evidence | .loom/progress/CORE-267.md | Focused and full repository validation results at current head | CORE-267 readiness | present | Core PR review | Refresh after head change. |
| EV-006 | fresh_verification_input | .loom/progress/CORE-267.md | EV-002 EV-003 EV-004 EV-005 | CORE-267 current implementation and validation | present | Core PR review | Refresh after validation, head, PR metadata, or carrier change. |
| EV-007 | non_goal_evidence | .loom/work-items/CORE-267.md | Prohibited actions and excluded repositories | CORE-267 safety boundary | present | No cross-repo mutation or external write | Stop if boundary changes. |

