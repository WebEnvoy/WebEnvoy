# CORE-259 Evidence Map

| Evidence ID | Evidence Type | Source Locator | Consumes | Binding | Freshness | Consumer Boundary | Remediation Direction |
|---|---|---|---|---|---|---|---|
| EV-001 | issue_tree_evidence | https://github.com/WebEnvoy/WebEnvoy/issues/259 https://github.com/WebEnvoy/WebEnvoy/issues/243 | Carrier repair scope and parent unblocker | CORE-259 scope | present | planning/review only | Re-read before PR metadata or closeout. |
| EV-002 | prior_failure_evidence | https://github.com/WebEnvoy/WebEnvoy/pull/258 | PR #258 failed because CORE-248 review entry reuse would overwrite retained implementation evidence | CORE-259 recovery path | present | carrier repair only | Use separate CORE-259 review entry. |
| EV-003 | retained_review_boundary | .loom/reviews/CORE-248.json | Existing CORE-248 implementation review evidence must not be changed | CORE-259 safety boundary | present | no overwrite allowed | Fail review if this file changes. |
| EV-004 | behavior_evidence | .loom/specs/CORE-259/spec.md | Carrier repair behavior, retained review boundary, and safety scenarios | CORE-259 acceptance | present | carrier repair only | Re-read if carrier scope changes. |
| EV-005 | test_evidence | .loom/specs/CORE-259/build-evidence.json | Validation command list and carrier-only test evidence | CORE-259 readiness | present | PR review and PR gate | Refresh after validation or head change. |
| EV-006 | carrier_evidence | .loom/status/current.md | Current pointer points to CORE-259 during the repair PR | CORE-259 carrier | present | carrier repair only | Rerun fact-chain after edits. |
| EV-007 | carrier_evidence | .loom/bootstrap/init-result.json | Fact-chain entry points point to CORE-259 during the repair PR | CORE-259 locator truth | present | carrier repair only | Rerun fact-chain after edits. |
| EV-008 | non_goal_evidence | .loom/work-items/CORE-259.md | Prohibited product and live external actions | CORE-259 safety boundary | present | no product behavior claim | Recheck if scope expands. |
| EV-009 | fresh_verification_input | .loom/progress/CORE-259.md | EV-004 and EV-005 combine into fresh CORE-259 verification input | CORE-259 current validation | present | PR review and PR gate | Refresh after validation or head change. |
