# Spec

## Goal

Provide one repository command that validates the Stage 2 schema fixtures and the minimum local Run Record read/write path so FR #94 has a consumable conformance carrier before moving to admission and query behavior.

## Required Behavior

- The root workspace exposes `pnpm conformance`.
- `packages/conformance` exists as a private workspace package named `@webenvoy/conformance`.
- The conformance command builds `@webenvoy/core-runtime` before running the self-check.
- The self-check reads local JSON Schema files from `packages/schemas/schemas`.
- Each schema fixture check confirms `$schema`, `$id`, `x-webenvoy` metadata, owner, status, compatibility boundary, schema version, and source ADR metadata.
- The self-check reads local fixtures from `packages/schemas/fixtures`.
- Each fixture must reference a local schema file, match the schema version declared in `x-webenvoy.schema_version`, and contain the schema-required top-level fields.
- The self-check writes and reads one successful read-only Run Record through the file-backed store.
- The successful Run Record uses the read-only submit fixture, result envelope fixture, and redacted evidence-ref fixture.
- The self-check writes and reads one admission-failure Run Record through the file-backed store.
- The failed Run Record uses structured failure and retention fields from the admission-failure fixture.
- The conformance check asserts Run Records remain refs-only and do not inline raw payload, DOM, HAR, screenshot, video, cookie, token, or local path data.
- The command uses Node.js standard library APIs and the existing core runtime store; it introduces no new external runtime dependency.
- Root README documents the conformance command.
- GH-100 item-specific Loom carriers bind the Work Item, branch, scope, and validation plan.

## Non-Goals

- Do not implement full JSON Schema validation with Ajv, generated TypeScript types, OpenAPI, API submission/query routes, runtime admission execution, result projection service behavior, Harbor/Lode/App repository changes, CLI/MCP/SDK/App integration, database/ORM/migration tooling, hosted service storage, or true-write behavior.
- Do not claim FR #94 complete until #100 has post-merge closeout evidence and #97 through #100 are confirmed closed.
- Do not close #100 in this PR body; closeout happens after merge evidence is recorded.

## Suite Applicability

- Suite path: minimal
- Required artifacts: .loom/specs/GH-100/spec.md, .loom/specs/GH-100/plan.md, and .loom/specs/GH-100/implementation-contract.md
- Evidence-map: present for review/merge-ready evidence binding.
- Full-suite artifacts not applicable: suite-index.md, research.md, contracts.md, readiness-checklist.md, consistency-analysis, execution breakdown.
- Rationale: This Work Item is a narrow Core conformance PR. It lands a repository-level runnable check for existing schemas, fixtures, and the local Run Record store, but does not implement public API routes, runtime admission/execution, generated consumers, or cross-repo integration.
- Consumer boundary: Review and PR Ready should consume the conformance package, root command, README command documentation, GH-100 carrier, local command results, PR metadata readback, and hosted checks.
- Recheck condition: Require broader suite artifacts when a later PR adds API submit/query behavior, full schema validation, admission execution, result projection, generated types, CLI/MCP/SDK/App-facing API, Harbor/Lode consumption, database storage, hosted service storage, or true-write guardrails.

## Acceptance

- `pnpm conformance` passes locally from a clean generated-output state.
- `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm lint` pass locally.
- `git diff --check` passes.
- The conformance self-check consumes existing schema and fixture files rather than duplicating contracts.
- The conformance self-check writes, reads, and lists Run Records through the existing local file store.
- No new external runtime dependency, database, ORM, migration framework, API route, or hosted storage is introduced.
- No API Server behavior changes are introduced.
