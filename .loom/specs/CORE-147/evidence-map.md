# Evidence Map

| Evidence id | Type | Source locator | Consumes | Binding | Freshness | Consumer boundary | Remediation direction |
| --- | --- | --- | --- | --- | --- | --- | --- |
| EV-001 | behavior_evidence | .loom/specs/CORE-147/spec.md | Scenario 1 Scenario 2 / acceptance criteria | CORE-147 / capability attribution behavior | present | review and merge-ready evidence only | Refresh after attribution scope changes. |
| EV-002 | test_evidence | .loom/progress/CORE-147.md | repo test suite and git diff checks | CORE-147 / local validation checks | present | review and merge-ready evidence only | Rerun local validation after schema/runtime/conformance edits. |
| EV-003 | fresh_verification_input | .loom/progress/CORE-147.md | EV-001 EV-002 | CORE-147 / latest validation summary | present | review and merge-ready evidence only | Refresh progress summary after validation changes. |
