# Implementation Contract

## Ownership

- Work Item: GH-99
- Branch: work/GH-99-run-record-store
- Owner: core-repo-control-thread

## Write Scope

- README.md
- pnpm-lock.yaml
- packages/core/**
- .loom/work-items/GH-99.md
- .loom/progress/GH-99.md
- .loom/status/current.md
- .loom/specs/GH-99/*
- .loom/bootstrap/init-result.json

## Forbidden Scope

- API submission/query routes
- API Server behavior changes
- Admission runtime execution
- Result projection implementation
- Harbor/Lode/App repositories
- Ajv or generated TypeScript types
- OpenAPI
- CLI/MCP/SDK/App-facing API integration
- Database, ORM, migration tooling, multi-backend abstraction, or hosted service storage
- GH-100 conformance runner behavior
- True writes
- Issue closure
- PR merge
- FR #94 closeout

## Acceptance Evidence

- Targeted core runtime self-check passes.
- Workspace build/typecheck/test/lint passes.
- Loom fact-chain, suite, carrier, evidence, and packaged build flow pass.
- PR body/head readback matches branch, Work Item, and head SHA before review/gate.
