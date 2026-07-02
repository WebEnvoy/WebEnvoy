# Implementation Contract

## Scope

- Branch: work/GH-110-write-guardrail
- Work Item: GH-110
- GitHub Issue: https://github.com/WebEnvoy/WebEnvoy/issues/110

## Owned Files

- packages/core/src/task-submission.ts
- packages/core/src/self-check.ts
- packages/core/README.md
- packages/schemas/fixtures/write-action-guardrail-run-record.fixture.json
- packages/schemas/README.md
- packages/conformance/src/self-check.ts
- packages/conformance/README.md
- README.md
- .loom/work-items/GH-110.md
- .loom/progress/GH-110.md
- .loom/status/current.md
- .loom/specs/GH-110/*

## Non-Owned / Forbidden Scope

- True write executor, write operation execution, real browser execution, or generic browser agent loop
- Approval UI, approval persistence, idempotency implementation, post-check implementation, reconciliation implementation, or unknown-outcome write recovery
- Formal product CLI, SDK, MCP, API submission endpoint, generated clients, or App UI
- Harbor, Lode, App, or other repositories
- Raw evidence retrieval, raw evidence store, screenshots, HAR, DOM, viewer URLs, cookies, tokens, local browser paths, or provider-private objects
- Database, ORM, migration tooling, multi-backend abstraction, hosted service storage, or complex recovery

## Acceptance Binding

- Non-read task policy requests produce failed/deferred Run Records before Lode/Harbor admission.
- True-write requests return `true_write_deferred`.
- Preview/action-request shapes return a structured guardrail failure and do not execute writes.
- Guardrail Run Records are readable through existing run/result/evidence query helpers.
- Schema fixture and conformance checks cover the guardrail shape.
- Workspace build/typecheck/test/lint, conformance, and smoke pass before PR Ready.
- Loom fact-chain, suite, carrier, evidence, and packaged build flow pass.
- PR metadata binds GH-110, branch `work/GH-110-write-guardrail`, current head SHA, and repository `WebEnvoy/WebEnvoy`.
