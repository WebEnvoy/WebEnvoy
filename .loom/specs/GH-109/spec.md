# Spec

## Goal

Add a minimal API/CLI smoke check proving the first read-only golden Run Record can be queried through the same Core run/result/evidence contracts by both API Server and a machine command.

## Required Behavior

- The smoke reuses `packages/schemas/fixtures/golden-read-only-run-record.fixture.json`; it must not invent a new run shape.
- The smoke seeds a temporary file-backed Run Record store from the golden fixture.
- The CLI side reads run, result, and evidence-ref projections through the existing Core query helpers.
- The API side reads the same run, result, and evidence-ref projections through the existing API Server query routes.
- The smoke asserts API responses match CLI/Core projections for:
  - `GET /runs/:run_id`
  - `GET /runs/:run_id/result`
  - `GET /runs/:run_id/evidence-refs`
- The root `pnpm smoke` command runs the smoke.
- Documentation identifies the command and explicitly keeps it as repo-local smoke rather than a full product CLI.
- API Server package metadata exposes generated TypeScript declarations when consumed as a workspace package by the smoke.

## Non-Goals

- Do not add write-side action request guardrail; GH-110 owns it.
- Do not add a formal product CLI, SDK/MCP full entrypoint, App UI, generated client, API submission path, hosted service, storage backend, history search, real executor, complex recovery, Harbor/Lode/App repository changes, raw evidence retrieval, or true writes.

## Suite Applicability

- Suite path: minimal
- Required artifacts: .loom/specs/GH-109/spec.md, .loom/specs/GH-109/plan.md, and .loom/specs/GH-109/implementation-contract.md
- Evidence-map: present for review/merge-ready evidence binding.
- Full-suite artifacts not applicable: suite-index.md, research.md, contracts.md, readiness-checklist.md, consistency-analysis, execution breakdown.
- Rationale: This Work Item adds one repo-local smoke over already-established run/result/evidence query contracts and the GH-108 golden fixture; it does not add new protocol fields, a formal CLI product, App integration, storage backends, raw evidence access, or write behavior.
- Consumer boundary: Review and PR Ready should consume ADR 0003/0005/0007/0008, the existing GH-106/GH-107 query surfaces, GH-108 golden fixture, smoke output, GH-109 carriers, local command results, PR metadata readback, and hosted checks.
- Recheck condition: Require broader suite artifacts when a later PR adds write guardrails, formal CLI/SDK/MCP entrypoints, App UI, generated clients, API submission, database storage, hosted service storage, real execution, or true-write behavior.

## Acceptance

- `pnpm --filter @webenvoy/conformance smoke` passes.
- `pnpm smoke` passes.
- `pnpm --filter @webenvoy/conformance typecheck` passes.
- `pnpm --filter @webenvoy/conformance test` passes.
- `pnpm --filter @webenvoy/api-server typecheck` passes.
- `pnpm --filter @webenvoy/api-server test` passes.
- `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm lint` pass.
- `pnpm conformance` passes.
- `git diff --check` passes.
- `jq empty .loom/bootstrap/init-result.json .loom/specs/GH-109/build-evidence.json` passes.
- `loom doctor`, `loom verify`, `loom fact-chain`, `loom suite validate`, `loom suite carrier validate`, `loom suite evidence validate`, and packaged Loom build flow pass for GH-109 before PR Ready.
- PR body/head readback matches Work Item `GH-109`, branch `work/GH-109-api-cli-smoke`, repository `WebEnvoy/WebEnvoy`, and current head after every push.
- No write guardrail, formal CLI product, App UI, SDK/MCP full entrypoint, API submission path, history search, storage backend, real executor, Harbor/Lode/App edit, raw evidence retrieval, or true write is introduced.
