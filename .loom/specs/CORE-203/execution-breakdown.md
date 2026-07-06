# CORE-203 Execution Breakdown

| Unit | Plan locator | Spec locator | Owner | Status | Validation |
|---|---|---|---|---|---|
| U-001 real-page write-preview fixtures | .loom/specs/CORE-203/plan.md#phase-1---fixture-records | .loom/specs/CORE-203/spec.md#scenario-s-001-write-precheck-request | Schema fixtures | in_progress | `pnpm --filter @webenvoy/schemas test` |
| U-002 action/approval/preview queries | .loom/specs/CORE-203/plan.md#phase-2---conformance-consumption | .loom/specs/CORE-203/spec.md#scenario-s-002-action-and-approval | Conformance | in_progress | `pnpm conformance` |
| U-003 invalidated states | .loom/specs/CORE-203/plan.md#phase-2---conformance-consumption | .loom/specs/CORE-203/spec.md#scenario-s-004-invalidated-preview | Conformance | in_progress | `pnpm conformance` |
| U-004 PR readiness | .loom/specs/CORE-203/plan.md#phase-4---pr-readiness | .loom/specs/CORE-203/readiness-checklist.md | Loom/PR metadata | pending | Loom checks and PR metadata preflight |
