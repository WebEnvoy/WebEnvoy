# Task Carrier

| carrier_type | carrier_locator | source_value | normalized_status | relationship | work_item_locator | breakdown_unit_locator | spec_scenario_locator | plan_phase_locator | validation_strategy_locator | provenance | freshness_rule |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| github_issue | https://github.com/WebEnvoy/WebEnvoy/issues/223 | CORE-223 anchored Core runtime admission/resource checks and covered the Harbor #234 site-resource facts consumption slice for Core #223/#243/#244; PR #262 is merged and issue #223 is closed, while PR #263 only syncs terminal closeout carrier truth | closed_out | primary | .loom/work-items/CORE-223.md | .loom/specs/CORE-223/plan.md#phases | .loom/specs/CORE-223/spec.md#scenarios | .loom/specs/CORE-223/plan.md#phases | .loom/progress/CORE-223.md#terminal-closeout-metadata | Authored from Core #223/#243/#244, Harbor #234, Lode #252, App #265 No-Go context, merged PR #262, and PR #263 closeout sync on 2026-07-09 UTC. | Recheck after issue state change, branch/head change, PR body metadata change, App/Harbor/Lode contract change, validation run, or closeout carrier merge. |

## Implementation Contract

- Input owner: WebEnvoy/WebEnvoy #223, with parent Core #243 and App #265 as downstream E2E consumer.
- Upstream facts: Harbor #234 provides `site-resource-facts` and `write-precheck-facts`; Lode #252/#235/#240 remain registry/capability truth only.
- Write ownership: `packages/core/src/runtime-task-chain.ts`, `packages/api-server/src/runtime-task-submit-self-check.ts`, `.loom/work-items/CORE-223.md`, `.loom/progress/CORE-223.md`, `.loom/specs/CORE-223/**`, `.loom/status/current.md`.
- Forbidden: App/Harbor/Lode code changes, real account/profile/Cookie/production page action, submit/publish/send/save, raw evidence persistence, hosted browser, marketplace, bulk collection, risk bypass.

## Integration Notes

Core now calls Harbor site-resource facts only for Lode package refs with `xiaohongshu` or `boss` site segments. Unsupported package refs keep the prior generic session/snapshot path.

Harbor site facts with states other than `available` are normalized as non-available Core facts, so Lode required facts remain fail-closed.
