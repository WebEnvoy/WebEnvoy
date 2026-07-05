# Evidence Map

| Evidence id | Type | Source locator | Consumes | Binding | Freshness | Consumer boundary | Remediation direction |
| --- | --- | --- | --- | --- | --- | --- | --- |
| EV-001 | behavior_evidence | .loom/specs/INIT-0001/spec.md | bootstrap carrier scope and suite path | INIT-0001 / carrier-only bootstrap behavior | present | review and merge-ready evidence only | Refresh after spec scope or suite path changes. |
| EV-002 | test_evidence | .loom/progress/INIT-0001.md | carrier validation command ledger | INIT-0001 / bootstrap validation checks | present | review and merge-ready evidence only | Rerun local validation after carrier edits. |
| EV-003 | fresh_verification_input | .loom/progress/INIT-0001.md | EV-001 EV-002 | INIT-0001 / latest validation summary | present | review and merge-ready evidence only | Refresh progress summary after validation changes. |
