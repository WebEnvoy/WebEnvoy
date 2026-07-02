# Implementation Contract

## Ownership

- Work Item: GH-106
- Branch: work/GH-106-run-query
- Owner: core-repo-control-thread

## Write Scope

- packages/core/src/run-query.ts
- packages/core/src/index.ts
- packages/core/src/self-check.ts
- packages/core/README.md
- packages/api-server/src/server.ts
- packages/api-server/src/index.ts
- packages/api-server/src/self-check.ts
- packages/api-server/package.json
- pnpm-lock.yaml
- .loom/work-items/GH-106.md
- .loom/progress/GH-106.md
- .loom/status/current.md
- .loom/bootstrap/init-result.json
- .loom/specs/GH-106/*
- .loom/reviews/GH-106*.json when authored after build readiness

## Forbidden Scope

- Result/evidence refs detail query endpoints
- Golden run fixture
- API/CLI smoke
- Write-side action request guardrail
- App UI, SDK/MCP full entrypoints, generated clients, or App integration
- History list/search/filtering, database/ORM/migration tooling, multi-backend abstraction, hosted service storage, or result store
- Browser/runtime executor, Harbor SDK/runtime calls, raw evidence retrieval, live sessions, or Harbor package imports
- Harbor, Lode, App, or other repository changes
- True-write behavior, write operation execution, write reconciliation, complex retry/recovery, or generic browser agent loops

## Acceptance Evidence

- Core runtime self-check covers run summary projection, store-backed success query, missing run, and invalid run id failure.
- API Server self-check covers `/runs/:run_id` success, missing run, malformed encoded run id, and existing health/readiness routes.
- Workspace build/typecheck/test/lint passes.
- Loom fact-chain, suite, carrier, evidence, and packaged build flow pass.
- PR body/head readback matches branch, Work Item, repository, and head SHA before review/gate.
