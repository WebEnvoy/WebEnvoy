# Spec

## Goal

Provide the first runnable WebEnvoy Core API Server skeleton for milestone #9 without introducing unused frameworks or implementing task execution.

## Required Behavior

- The repository has a pnpm workspace and Node.js 24 TypeScript project baseline.
- `packages/api-server` exposes a native Node.js HTTP server factory.
- `GET /health` returns a JSON health response.
- `GET /readiness` returns a JSON readiness response for the skeleton API Server.
- Unknown routes return a structured JSON `not_found` response.
- Unsupported methods return a structured JSON `method_not_allowed` response.
- A runnable self-check starts the server on an ephemeral local port and verifies health, readiness, and not_found behavior.
- README documents the new local commands.
- GH-97 item-specific Loom carriers bind the Work Item, branch, scope, and validation plan.

## Non-Goals

- Do not implement task submission, admission, Run Record persistence, result envelope, evidence refs, query endpoints, OpenAPI, JSON Schema files, CLI/MCP/SDK, App integration, Harbor/Lode integration, hosted deployment, real browser execution, or true writes.
- Do not modify other repositories.
- Do not close #94 or #97 in this PR body; closeout happens after merge evidence is recorded.
- Do not update shared `.loom/status/current.md` unless a Loom gate explicitly requires current-item alignment for this PR.

## Suite Applicability

- Suite path: minimal
- Required artifacts: .loom/specs/GH-97/spec.md and .loom/specs/GH-97/plan.md
- Full-suite artifacts not applicable: suite-index.md, research.md, contracts.md, readiness-checklist.md, consistency-analysis, execution breakdown.
- Evidence-map: present only as review/merge-ready evidence binding for this minimal PR; it does not expand the product scope.
- Rationale: This Work Item is a narrow code skeleton and smoke surface with no final schema/API contract, persistence, admission, runtime execution, or cross-repo consumer. The runnable self-check and TypeScript checks are the primary evidence.
- Consumer boundary: Review and PR Ready should consume the code diff, README command documentation, GH-97 carrier, build evidence, local command results, PR metadata readback, and hosted checks.
- Recheck condition: Require broader suite artifacts and contract fixtures when a later PR adds task submission, schemas, Run Record persistence, admission, result/query behavior, CLI/MCP/SDK, App-facing API, Harbor/Lode consumption, or true-write guardrails.

## Acceptance

- `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm lint` pass locally.
- The self-check proves the API Server can start and answer `/health` and `/readiness`.
- No HTTP framework or non-TypeScript runtime is introduced.
- New runtime dependencies are limited to TypeScript development tooling and documented by PR/body evidence.
