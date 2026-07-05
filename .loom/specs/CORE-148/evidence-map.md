# Evidence Map

| Evidence id | Type | Source locator | Consumes | Binding | Freshness | Consumer boundary | Remediation direction |
| --- | --- | --- | --- | --- | --- | --- | --- |
| EV-001 | behavior_evidence | packages/core/src/lode-admission.ts | lifecycle admission mapping | CORE-148 capability admission | present | review and merge-ready evidence only | Refresh after Lode lifecycle vocabulary or admission mapping changes. |
| EV-002 | behavior_evidence | packages/core/src/failure-attribution.ts | failure attribution categories | CORE-148 failure attribution | present | review and merge-ready evidence only | Refresh after failure taxonomy changes. |
| EV-003 | behavior_evidence | packages/core/src/run-record-store.ts | post-check Run Record refs-only boundary | CORE-148 post-check summary | present | review and merge-ready evidence only | Refresh after Run Record persistence fields change. |
| EV-004 | behavior_evidence | packages/core/src/capability-query.ts | capability recent run and failure summary query | CORE-148 App/API query | present | review and merge-ready evidence only | Refresh after App/API query shape changes. |
| EV-005 | schema_fixture_evidence | packages/schemas/schemas/capability-run-query.schema.json | App-consumable capability run query schema | CORE-148 schema fixture | present | review and merge-ready evidence only | Refresh after query envelope schema changes. |
| EV-006 | test_evidence | .loom/progress/CORE-148.md | local validation command conclusions | CORE-148 validation | present | review and merge-ready evidence only | Rerun validation after code, schema, or fixture edits. |
| EV-007 | fresh_verification_input | .loom/progress/CORE-148.md | EV-001 EV-002 EV-003 EV-004 EV-005 EV-006 | CORE-148 fresh verification | present | review and merge-ready evidence only | Refresh after any code, schema, fixture, validation, PR head, or issue state change. |
