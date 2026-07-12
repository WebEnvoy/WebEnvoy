# CORE-270 Evidence Map

| Evidence ID | Evidence Type | Source Locator | Consumes | Binding | Freshness | Consumer Boundary | Remediation Direction |
|---|---|---|---|---|---|---|---|
| EV-001 | issue_tree_evidence | https://github.com/WebEnvoy/WebEnvoy/issues/270 | Work Item scope and non-goals | CORE-270 scope | present | review and PR readiness only | Re-read if issue changes. |
| EV-002 | upstream_fact_evidence | https://github.com/WebEnvoy/Harbor/pull/270 | merged XHS page semantics and opaque target producer | CORE-270 Harbor input | present | Harbor-owned behavior only | Re-read after Harbor contract changes. |
| EV-003 | behavior_evidence | packages/core/src/runtime-task-chain.ts; packages/core/src/detail-target-store.ts | XHS detail admission/dispatch/outcome and opaque-ref lifecycle | product head ec3a698 | fresh | Core behavior only | Refresh after implementation changes. |
| EV-004 | test_evidence | packages/core/src/self-check.ts; packages/api-server/src/runtime-task-submit-self-check.ts | positive, replay, binding, expiry, contract drift, persistence failure and zero-dispatch paths | product head ec3a698 | fresh | local tests only; no live proof | Refresh after tests/head change. |
| EV-005 | fresh_verification_input | .loom/progress/CORE-270.md | EV-003 EV-004 | 2026-07-12T13:32Z product-head validation | fresh | PR readiness only | Replace with packaged App runtime refs for issue closeout. |
