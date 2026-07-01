# Implementation Contract

## Ownership

- Work Item: GH-104
- Branch: work/GH-104-harbor-refs
- Owner: core-repo-control-thread

## Write Scope

- packages/core/src/harbor-admission.ts
- packages/core/src/task-submission.ts
- packages/core/src/run-record-store.ts
- packages/core/src/index.ts
- packages/core/src/self-check.ts
- packages/core/README.md
- packages/schemas/schemas/run-record.schema.json
- packages/schemas/fixtures/admission-failure-run-record.fixture.json
- packages/conformance/src/self-check.ts
- .loom/work-items/GH-104.md
- .loom/progress/GH-104.md
- .loom/status/current.md
- .loom/specs/GH-104/*
- .loom/reviews/GH-104*.json

## Forbidden Scope

- GH-105 result/failure envelope output beyond existing Run Record failure fields
- API query, smoke, App integration, CLI/MCP/SDK-facing API
- Harbor SDK/runtime calls, browser launches, live sessions, evidence retrieval, or Harbor package imports
- Harbor, Lode, App, or other repository changes
- Harbor private fields or raw evidence bodies
- Lode package body copying, registry store ownership, validator execution, normalizer or post-check execution
- Action execution loop, retry/recovery orchestration, or cancel endpoint
- Database, ORM, migration tooling, multi-backend abstraction, or hosted service storage
- True-write behavior
- Issue closure
- PR merge
- FR #95 closeout before GH-105 is complete

## Acceptance Evidence

- Core runtime self-check passes and covers accepted Harbor binding, missing runtime ref failure, and capture denied failure.
- Workspace build/typecheck/test/lint/conformance passes.
- Loom fact-chain, suite, carrier, evidence, and packaged build flow pass.
- PR body/head readback matches branch, Work Item, repository, and head SHA before review/gate.
