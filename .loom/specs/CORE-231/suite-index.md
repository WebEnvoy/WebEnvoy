# CORE-231 Suite Index

## Suite Path

- Suite path: full
- Path decision: Core runtime write-precheck behavior, App-facing result facts, action request/approval/no-submit semantics, self-checks, PR review, hosted gate, and closeout are touched.
- Provenance: Core #230/#231/#232/#233/#234 read back on 2026-07-07 UTC; Harbor #12 and Lode #14 closed.

## Artifact Inventory

| Artifact | Locator | Status | Consumer |
|---|---|---|---|
| spec | .loom/specs/CORE-231/spec.md | present | build, review, PR ready |
| plan | .loom/specs/CORE-231/plan.md | present | build, validation |
| contracts | .loom/specs/CORE-231/contracts.md | present | write-precheck contract |
| implementation contract | .loom/specs/CORE-231/implementation-contract.md | present | ownership and verification boundary |
| readiness checklist | .loom/specs/CORE-231/readiness-checklist.md | present | PR ready readback |
| execution breakdown | .loom/specs/CORE-231/execution-breakdown.md | present | task carrier mapping |
| task carrier | .loom/specs/CORE-231/task-carrier.md | present | Work Item/issue binding |
| evidence map | .loom/specs/CORE-231/evidence-map.md | present | validation evidence |
| consistency analysis | .loom/specs/CORE-231/consistency-analysis.md | present | scope and carrier drift checks |

## Recheck Conditions

- Recheck if PR branch/head changes, issue scope changes, Harbor/Lode public facts change, generated write-precheck behavior changes, App dependency consumption starts, or validation is rerun.
