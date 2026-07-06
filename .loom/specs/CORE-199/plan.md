# CORE-199 Plan

## Implementation Goal

Extend existing Core Run Record query projection instead of adding a new store, transport, or dependency.

## Phases

### Phase 1

- Objective: Extend query projection.
- Deliverable: evidence summaries add recorded_at/runtime_session_ref; session refs and failure reason query helpers are added.
- Exit condition: Core runtime self-check validates evidence/session/failure query behavior.

### Phase 2

- Objective: Expose App-facing API routes.
- Deliverable: GET `/runs/:id/session-refs` and GET `/runs/:id/failure` added beside existing run/result/evidence routes.
- Exit condition: API Server self-check validates new routes and invalid run id handling.

### Phase 3

- Objective: Document schema and conformance.
- Deliverable: session refs/failure reason JSON Schema fixtures and real-site conformance query checks.
- Exit condition: schemas and conformance checks pass.

### Phase 4

- Objective: PR readiness.
- Deliverable: Loom carriers, local validation, commit, push, non-draft PR, metadata readback/preflight.
- Exit condition: PR metadata covers #189/#199/#200/#201/#202 and excludes declared non-goals.

## Validation

- `pnpm --filter @webenvoy/core-runtime test`
- `pnpm --filter @webenvoy/api-server test`
- `pnpm --filter @webenvoy/schemas test`
- `pnpm conformance`
- `pnpm typecheck`
- `git diff --check`
- `loom fact-chain --target . --json`
- `loom verify --target . --json`
- `loom suite validate --target . --item CORE-199 --json`
- `loom suite carrier validate --target . --item CORE-199 --json`
- `loom suite evidence validate --target . --item CORE-199 --json`
- `loom pr metadata-readback` and `loom pr metadata-preflight` after PR creation.

## Scenario Validation Mapping

- Scenario S-001 -> validation: automated by `pnpm --filter @webenvoy/core-runtime test` and `pnpm conformance`; validates evidence refs include source, recorded_at, raw_access, and runtime_session_ref.
- Scenario S-002 -> validation: automated by `pnpm --filter @webenvoy/core-runtime test`, `pnpm --filter @webenvoy/api-server test`, and `pnpm conformance`; validates session refs query exposes Harbor public refs only.
- Scenario S-003 -> validation: automated by `pnpm --filter @webenvoy/core-runtime test`, `pnpm --filter @webenvoy/api-server test`, and `pnpm conformance`; validates login-required, page-changed, field-unavailable, risk-prompt, and takeover recovery hints.
- Scenario S-004 -> validation: automated by `pnpm --filter @webenvoy/api-server test`; validates GET run/result/evidence/session/failure routes and invalid run id failures.

## Constraints

- Reuse existing FileRunRecordStore and query helpers.
- Do not add runtime dependencies, persistence backends, background jobs, or raw evidence access.
- Do not modify App, Harbor, or Lode code.

## Ready For Review

- [ ] Local validation passed on current head.
- [ ] PR metadata readback matches CORE-199 branch/head/repository and issue coverage.
