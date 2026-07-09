# Task Carrier

| carrier_type | carrier_locator | source_value | normalized_status | relationship | work_item_locator | breakdown_unit_locator | spec_scenario_locator | plan_phase_locator | validation_strategy_locator | provenance | freshness_rule |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| github_issue | https://github.com/WebEnvoy/WebEnvoy/issues/244 | CORE-244 anchors the Core #244 process-level API server regression guard consumed by Core #243 and App #265 | in_progress | primary | .loom/work-items/CORE-244.md | .loom/specs/CORE-244/implementation-contract.md | .loom/specs/CORE-244/spec.md#scenarios | .loom/specs/CORE-244/plan.md#phases | .loom/specs/CORE-244/plan.md#validation | Authored from Core #243/#244 and App #265 runtime failure evidence read back on 2026-07-09 UTC. | Recheck after issue state change, branch/head change, Core API server endpoint change, validation run, or main-controller PR creation. |
