# Implementation Contract

## Ownership

- Work Item: GH-100
- Branch: work/GH-100-conformance-self-check
- Owner: core-repo-control-thread

## Write Scope

- README.md
- package.json
- pnpm-lock.yaml
- packages/core/src/index.ts
- packages/conformance/**
- .loom/work-items/GH-100.md
- .loom/progress/GH-100.md
- .loom/status/current.md
- .loom/specs/GH-100/*
- .loom/bootstrap/init-result.json
- .loom/reviews/GH-100*.json

## Forbidden Scope

- API submission/query routes
- API Server behavior changes
- Admission runtime execution beyond fixture/store checks
- Result projection implementation
- Harbor/Lode/App repositories
- Ajv or generated TypeScript types
- OpenAPI
- CLI/MCP/SDK/App-facing API integration
- Database, ORM, migration tooling, multi-backend abstraction, or hosted service storage
- True-write behavior
- Issue closure
- PR merge
- FR #94 closeout before #100 post-merge evidence exists

## Acceptance Evidence

- Root conformance command passes.
- Workspace build/typecheck/test/lint passes.
- Loom fact-chain, suite, carrier, evidence, and packaged build flow pass.
- PR body/head readback matches branch, Work Item, and head SHA before review/gate.
