# Implementation Contract

## Ownership

- Work Item: GH-105
- Branch: work/GH-105-result-envelope
- Owner: core-repo-control-thread

## Write Scope

- packages/core/src/result-envelope.ts
- packages/core/src/index.ts
- packages/core/src/self-check.ts
- packages/core/README.md
- packages/schemas/schemas/result-envelope.schema.json
- packages/schemas/fixtures/result-envelope-failure.fixture.json
- packages/conformance/src/self-check.ts
- .loom/work-items/GH-105.md
- .loom/progress/GH-105.md
- .loom/status/current.md
- .loom/bootstrap/init-result.json
- .loom/specs/GH-105/*
- .loom/reviews/GH-105*.json

## Forbidden Scope

- API query, smoke, App integration, CLI/MCP/SDK-facing query API
- Harbor SDK/runtime calls, browser launches, live sessions, evidence retrieval, or Harbor package imports
- Harbor, Lode, App, or other repository changes
- Lode package body copying, registry store ownership, validator execution, normalizer execution, or post-check execution
- Action execution loop, retry/recovery orchestration, cancel endpoint, or true execution worker
- Database, ORM, migration tooling, multi-backend abstraction, result store, or hosted service storage
- True-write behavior or write reconciliation
- FR #96 query/smoke work

## Acceptance Evidence

- Core runtime self-check passes and covers terminal success envelope, terminal failure envelope, Run Record fields, and private/raw result data rejection.
- Schema self-check passes and covers success/failure Result Envelope fixtures.
- Conformance passes and covers result/failure helpers plus admission-failure Run Record fixture.
- Workspace build/typecheck/test/lint/conformance passes.
- Loom fact-chain, suite, carrier, evidence, and packaged build flow pass.
- PR body/head readback matches branch, Work Item, repository, and head SHA before review/gate.
