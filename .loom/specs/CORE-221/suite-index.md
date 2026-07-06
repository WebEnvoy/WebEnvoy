# CORE-221 Suite Index

## Suite Path

- Suite path: full
- Path decision: Core admission, package locks, resource facts, runtime session refs, and privacy rejection are touched.
- Provenance: Core #220/#221/#222/#223/#224, Harbor #198/#203, and Lode #230 read back on 2026-07-06 UTC.

## Artifact Inventory

| Artifact | Locator | Status | Consumer |
|---|---|---|---|
| spec | .loom/specs/CORE-221/spec.md | present | build, review, PR ready |
| plan | .loom/specs/CORE-221/plan.md | present | build, validation |
| research | .loom/specs/CORE-221/research.md | present | dependency and no-copy boundary |
| contracts | .loom/specs/CORE-221/contracts.md | present | admission contract |
| implementation contract | .loom/specs/CORE-221/implementation-contract.md | present | ownership and verification boundary |
| readiness checklist | .loom/specs/CORE-221/readiness-checklist.md | present | PR ready readback |
| execution breakdown | .loom/specs/CORE-221/execution-breakdown.md | present | task carrier mapping |
| task carrier | .loom/specs/CORE-221/task-carrier.md | present | Work Item/issue binding |
| evidence map | .loom/specs/CORE-221/evidence-map.md | present | validation evidence |
| consistency analysis | .loom/specs/CORE-221/consistency-analysis.md | present | scope and carrier drift checks |

## Recheck Conditions

- Recheck if PR branch/head changes, issue scope changes, Harbor/Lode public contract changes, admission fields change, or validation is rerun.
