# CORE-248 Evidence Map

| Evidence ID | Evidence Type | Source Locator | Consumes | Binding | Freshness | Consumer Boundary | Remediation Direction |
|---|---|---|---|---|---|---|---|
| EV-001 | issue_tree_evidence | https://github.com/WebEnvoy/WebEnvoy/issues/248 https://github.com/WebEnvoy/WebEnvoy/issues/244 https://github.com/WebEnvoy/WebEnvoy/issues/243 | Core reopened result/evidence refs and submit/admission chain | CORE-248 scope | present | planning/review only | Re-read before PR metadata, review, or closeout. |
| EV-002 | behavior_evidence | .loom/specs/CORE-248/spec.md | S-001/S-002/S-003/S-004 behavior and non-goal boundaries | CORE-248 acceptance | present | Core PR review only | Refresh after behavior or boundary changes. |
| EV-003 | implementation_evidence | packages/core/src/runtime-task-chain.ts | Terminal read-only completion from Harbor scene/evidence refs | CORE-248 Core implementation | present | Core refs-only runtime behavior | Rerun typecheck/tests after changes. |
| EV-004 | test_evidence | packages/api-server/src/runtime-task-submit-self-check.ts | Mock Lode registry and mock Harbor local runtime API terminal run assertions, including mismatched/missing scene URLs staying non-terminal and invalid evidence refs failing closed | CORE-248 validation | present | Mock evidence only; not live runtime evidence | Supplement with live App E2E only after explicit user permission. |
| EV-005 | validation_evidence | .loom/progress/CORE-248.md | Focused validation commands and results | CORE-248 readiness | present | Core PR review only | Refresh after commit/head change. |
| EV-006 | fresh_verification_input | .loom/progress/CORE-248.md | EV-002 EV-003 EV-004 EV-005 | CORE-248 current behavior and validation evidence | present | Core PR review only | Refresh after validation, branch/head, PR metadata, or carrier changes. |
| EV-007 | non_goal_evidence | .loom/work-items/CORE-248.md | Prohibited actions and excluded repos | CORE-248 safety boundary | present | No App/Harbor/Lode mutation and no external visible action | Recheck if scope changes. |
