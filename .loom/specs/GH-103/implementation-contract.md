# Implementation Contract

## Ownership

- Work Item: GH-103
- Branch: work/GH-103-resource-refs
- Owner: core-repo-control-thread

## Write Scope

- packages/core/src/lode-admission.ts
- packages/core/src/task-submission.ts
- packages/core/src/run-record-store.ts
- packages/core/src/index.ts
- packages/core/src/self-check.ts
- packages/core/README.md
- packages/schemas/schemas/run-record.schema.json
- packages/schemas/fixtures/read-only-submit.fixture.json
- packages/schemas/fixtures/admission-failure-run-record.fixture.json
- packages/schemas/fixtures/result-envelope-success.fixture.json
- packages/schemas/fixtures/evidence-ref-redacted.fixture.json
- packages/conformance/src/self-check.ts
- .loom/work-items/GH-103.md
- .loom/progress/GH-103.md
- .loom/status/current.md
- .loom/specs/GH-103/*
- .loom/bootstrap/init-result.json
- .loom/reviews/GH-103*.json

## Forbidden Scope

- Harbor runtime/evidence refs and live fact matching
- Result envelope/failure reason output beyond existing Run Record failure fields
- API query, smoke, App integration, CLI/MCP/SDK-facing API
- Harbor, Lode, App, or other repository changes
- Lode package body copying, fixture copying, registry store ownership, validator execution, schema body validation, normalizer or post-check execution
- Hosted registry, marketplace, install/sync/pin/rollback behavior
- Action execution loop, retry/recovery orchestration, or cancel endpoint
- Database, ORM, migration tooling, multi-backend abstraction, or hosted service storage
- True-write behavior
- Issue closure
- PR merge
- FR #95 closeout before GH-104 and GH-105 are complete

## Acceptance Evidence

- Core runtime self-check passes and covers accepted Lode admission, invalid Lode contract failure, and non-read operation rejection.
- Workspace build/typecheck/test/lint/conformance passes.
- Loom fact-chain, suite, carrier, evidence, and packaged build flow pass.
- PR body/head readback matches branch, Work Item, repository, and head SHA before review/gate.
