# Implementation Contract

## Scope

- Branch: work/GH-109-api-cli-smoke
- Work Item: GH-109
- GitHub Issue: https://github.com/WebEnvoy/WebEnvoy/issues/109

## Owned Files

- packages/conformance/src/api-cli-smoke.ts
- packages/conformance/package.json
- packages/conformance/README.md
- packages/api-server/package.json
- package.json
- pnpm-lock.yaml
- README.md
- .loom/work-items/GH-109.md
- .loom/progress/GH-109.md
- .loom/status/current.md
- .loom/bootstrap/init-result.json
- .loom/specs/GH-109/*

## Non-Owned / Forbidden Scope

- Write-side action request guardrail
- Formal product CLI, SDK, MCP, or App UI entrypoints
- API submission path
- Harbor, Lode, App, or other repositories
- Raw evidence retrieval, raw evidence store, screenshots, HAR, DOM, viewer URLs, cookies, tokens, local browser paths, or provider-private objects
- Database, ORM, migration tooling, multi-backend abstraction, hosted service storage, real executor, complex recovery, or true writes

## Acceptance Binding

- API/CLI smoke passes against the GH-108 golden read-only Run Record fixture.
- API responses match CLI/Core projections for run, result, and evidence-ref queries.
- Conformance and API Server typecheck/test pass.
- Workspace build/typecheck/test/lint and conformance pass before PR Ready.
- Loom fact-chain, suite, carrier, evidence, and packaged build flow pass.
- PR metadata binds GH-109, branch `work/GH-109-api-cli-smoke`, current head SHA, and repository `WebEnvoy/WebEnvoy`.
