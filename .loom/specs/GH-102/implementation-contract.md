# Implementation Contract

## Ownership

- Work Item: GH-102
- Branch: work/GH-102-run-lifecycle
- Owner: core-repo-control-thread

## Write Scope

- packages/core/src/run-record-store.ts
- packages/core/src/index.ts
- packages/core/src/self-check.ts
- packages/conformance/src/self-check.ts
- .loom/work-items/GH-102.md
- .loom/progress/GH-102.md
- .loom/status/current.md
- .loom/specs/GH-102/*
- .loom/bootstrap/init-result.json
- .loom/reviews/GH-102*.json

## Forbidden Scope

- HTTP API routes
- CLI/MCP/SDK/App-facing API integration
- Harbor or Lode repository changes
- Lode package-body resolution or copying
- Harbor runtime session binding or execution
- Action execution loop, retry/recovery orchestration, or cancel endpoint
- Result envelope rewrite or evidence retrieval
- Generated TypeScript types, Ajv integration, or OpenAPI
- Database, ORM, migration tooling, multi-backend abstraction, or hosted service storage
- True-write behavior
- Issue closure
- PR merge
- FR #95 closeout before remaining #95 Work Items and cross-repo dependencies are resolved

## Acceptance Evidence

- Core runtime self-check passes.
- Workspace build/typecheck/test/lint/conformance passes.
- Loom fact-chain, suite, carrier, evidence, and packaged build flow pass.
- PR body/head readback matches branch, Work Item, and head SHA before review/gate.
