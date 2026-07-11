# CORE-227 Evidence Map

| Evidence ID | Evidence Type | Source Locator | Consumes | Binding | Freshness | Consumer Boundary | Remediation Direction |
|---|---|---|---|---|---|---|---|
| EV-001 | issue_tree_evidence | https://github.com/WebEnvoy/WebEnvoy/issues/227 | #227 acceptance and exclusions | CORE-227 scope | present | planning/review | Re-read before PR metadata or scope changes. |
| EV-002 | upstream_contract_evidence | Harbor `387265eb`; Lode `e36a4a7` | BOSS operation, summary, pin, refs, and failure contracts | CORE-227 upstream binding | present | read-only contract consumption | Re-read if either upstream pin changes. |
| EV-003 | behavior_evidence | packages/api-server/src/server.ts packages/core/src/runtime-task-chain.ts | S-001 through S-006 exact parser, dispatch, validation, and refs-only projection | CORE-227 implementation | present | Core API/runtime and semantic review | Rerun focused and full checks after implementation changes. |
| EV-004 | test_evidence | packages/api-server/src/runtime-task-submit-self-check.ts packages/api-server/src/runtime-process-self-check.ts | BOSS parser/process boundary and success; query/city/page/limit/pin/session/control/challenge/refs/outcome negatives; XHS regression | CORE-227 validation | present | local contract/process evidence only | Extend the self-check if a trust-boundary case changes. |
| EV-005 | fresh_verification_input | .loom/specs/CORE-227/build-evidence.json | EV-003 EV-004 | current CORE-227 head and validation | present | PR readiness and review | Refresh head and command results after every commit or validation change. |
| EV-006 | non_goal_evidence | .loom/work-items/CORE-227.md | Detail #270, write-precheck, parent FR, live-account E2E, merge, and closure exclusions | CORE-227 safety boundary | present | scope/safety review | Stop and re-scope if an excluded action becomes required. |
