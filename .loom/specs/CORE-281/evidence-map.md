# CORE-281 Evidence Map

| Evidence ID | Evidence Type | Source Locator | Consumes | Binding | Freshness | Consumer Boundary | Remediation Direction |
|---|---|---|---|---|---|---|---|
| EV-001 | issue_tree_evidence | https://github.com/WebEnvoy/WebEnvoy/issues/281 | Work Item scope, canonical failure, entrypoints, and non-goals | CORE-281 scope | present | review and PR readiness only | Re-read if issue #281 changes. |
| EV-002 | upstream_fact_evidence | WebEnvoy/Lode merge f45b17990a6b1451a7a0ff55ec110c310e66f196 | Final registry and operation admission policy shape | CORE-281 Lode input | present | Lode-owned policy contract only | Re-read after Lode policy or digest changes. |
| EV-003 | behavior_evidence | packages/core/src/runtime-task-chain.ts | Shared policy validation, pre-Harbor rejection, and XHS preservation | CORE-281 acceptance | present | Core admission behavior only | Refresh after behavior or boundary changes. |
| EV-004 | test_evidence | packages/api-server/src/runtime-task-submit-self-check.ts | Direct Core, five entrypoints, three BOSS operations, zero Harbor calls, drift rejection, XHS success, and full checks | CORE-281 validation | present | synthetic tests and repository validation only; no production page evidence | Refresh after code, tests, or validation changes. |
| EV-005 | fresh_verification_input | .loom/progress/CORE-281.md | EV-003 EV-004 | CORE-281 current product-head behavior and validation | present | review and PR readiness only | Refresh after head, validation, review, or carrier changes. |
