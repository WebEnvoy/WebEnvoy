# Implementation Contract

## Scope

- Branch: work/GH-107-result-evidence-query
- Work Item: GH-107
- GitHub Issue: https://github.com/WebEnvoy/WebEnvoy/issues/107

## Owned Files

- packages/core/src/result-query.ts
- packages/core/src/index.ts
- packages/core/src/self-check.ts
- packages/core/README.md
- packages/api-server/src/server.ts
- packages/api-server/src/self-check.ts
- .loom/work-items/GH-107.md
- .loom/progress/GH-107.md
- .loom/status/current.md
- .loom/bootstrap/init-result.json
- .loom/specs/GH-107/*

## Non-Owned / Forbidden Scope

- Golden run fixture
- API/CLI smoke
- Write-side action request guardrail
- App UI, SDK, MCP, or full CLI entrypoints
- Harbor, Lode, App, or other repositories
- Raw evidence retrieval, raw evidence store, screenshots, HAR, DOM, viewer URLs, cookies, tokens, or provider-private objects
- Database, ORM, migration tooling, multi-backend abstraction, result store, hosted service storage, real executor, complex recovery, or true writes

## Acceptance Binding

- Core runtime typecheck and self-check pass.
- API Server typecheck and self-check pass.
- Full workspace build/typecheck/test/lint pass before PR Ready.
- Loom fact-chain, suite, carrier, evidence, and packaged build flow pass.
- PR metadata binds GH-107, branch `work/GH-107-result-evidence-query`, current head SHA, and repository `WebEnvoy/WebEnvoy`.
