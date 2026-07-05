# CORE-177 Evidence Map

| Evidence ID | Evidence Type | Source Locator | Consumes | Binding | Freshness | Consumer Boundary | Remediation Direction |
|---|---|---|---|---|---|---|---|
| EV-001 | behavior_evidence | .loom/specs/CORE-177/spec.md | scenarios and acceptance criteria | CORE-177 / preview result envelope behavior | present | review and merge-ready evidence only | Refresh after preview result, schema, query, or failure-class behavior changes. |
| EV-002 | test_evidence | .loom/progress/CORE-177.md | targeted tests, schema tests, conformance, typecheck, diff check, Loom verify/fact-chain | CORE-177 / local validation checks | present | review and merge-ready evidence only | Rerun local validation after code, schema, fixture, or carrier edits. |
| EV-003 | fresh_verification_input | .loom/progress/CORE-177.md | EV-001 EV-002 | CORE-177 / latest validation summary | present | review and merge-ready evidence only | Refresh progress summary after validation changes. |
