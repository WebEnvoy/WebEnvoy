# CORE-199 Execution Breakdown

| Unit | Plan locator | Spec locator | Owner | Status | Validation |
|---|---|---|---|---|---|
| U-001 query projection | .loom/specs/CORE-199/plan.md#phase-1 | .loom/specs/CORE-199/spec.md#scenarios | Core runtime | in_progress | `pnpm --filter @webenvoy/core-runtime test` |
| U-002 API routes | .loom/specs/CORE-199/plan.md#phase-2 | .loom/specs/CORE-199/spec.md#scenario-s-004-api-consumption | API Server | in_progress | `pnpm --filter @webenvoy/api-server test` |
| U-003 schema/conformance | .loom/specs/CORE-199/plan.md#phase-3 | .loom/specs/CORE-199/spec.md#acceptance-criteria | Schema/conformance | in_progress | `pnpm --filter @webenvoy/schemas test`; `pnpm conformance` |
| U-004 PR readiness | .loom/specs/CORE-199/plan.md#phase-4 | .loom/specs/CORE-199/readiness-checklist.md | Loom/PR metadata | pending | Loom checks and PR metadata preflight |
