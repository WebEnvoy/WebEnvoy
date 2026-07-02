# Implementation Contract

## Scope

- Branch: work/GH-108-golden-run-fixture
- Work Item: GH-108
- GitHub Issue: https://github.com/WebEnvoy/WebEnvoy/issues/108

## Owned Files

- packages/schemas/fixtures/golden-read-only-run-record.fixture.json
- packages/conformance/src/self-check.ts
- packages/conformance/README.md
- packages/schemas/README.md
- .loom/work-items/GH-108.md
- .loom/progress/GH-108.md
- .loom/status/current.md
- .loom/bootstrap/init-result.json
- .loom/specs/GH-108/*

## Non-Owned / Forbidden Scope

- API/CLI smoke
- Write-side action request guardrail
- App UI, SDK, MCP, or full CLI entrypoints
- Harbor, Lode, App, or other repositories
- Raw evidence retrieval, raw evidence store, screenshots, HAR, DOM, viewer URLs, cookies, tokens, local browser paths, or provider-private objects
- Database, ORM, migration tooling, multi-backend abstraction, hosted service storage, real executor, complex recovery, or true writes

## Acceptance Binding

- Schema package self-check passes.
- Conformance typecheck and self-check pass.
- Workspace build/typecheck/test/lint pass before PR Ready.
- Loom fact-chain, suite, carrier, evidence, and packaged build flow pass.
- PR metadata binds GH-108, branch `work/GH-108-golden-run-fixture`, current head SHA, and repository `WebEnvoy/WebEnvoy`.
