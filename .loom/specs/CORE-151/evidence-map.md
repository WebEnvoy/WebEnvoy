# Evidence Map

| Evidence id | Type | Source locator | Consumes | Binding | Freshness | Consumer boundary | Remediation direction |
| --- | --- | --- | --- | --- | --- | --- | --- |
| EV-001 | behavior_evidence | .loom/specs/CORE-151/spec.md | Scenario 1 Scenario 2 Scenario 3 / acceptance criteria | CORE-151 / Result Envelope output schema projection | present | review and merge-ready evidence only | Refresh after Result Envelope schema or projection changes. |
| EV-002 | test_evidence | .loom/progress/CORE-151.md | targeted tests, conformance smoke, typecheck, git diff check | CORE-151 / local validation checks | present | review and merge-ready evidence only | Rerun local validation after Core/schema edits. |
| EV-003 | fresh_verification_input | .loom/progress/CORE-151.md | EV-001 EV-002 | CORE-151 / latest validation summary | present | review and merge-ready evidence only | Refresh progress summary after validation changes. |
