# Spec

## Goal

Add a stable golden Run Record fixture for the first read-only task so later Core API/CLI smoke can reuse one audited run shape without inventing new fields.

## Required Behavior

- Add a schema-bound `golden-read-only-run-record.fixture.json` under `packages/schemas/fixtures/`.
- The golden fixture represents a terminal successful read-only run for the existing `read-public-page` task.
- The fixture reuses existing task intent, Lode capability/package ref, Harbor runtime binding refs, result ref, evidence ref, and active retention semantics from GH-101 through GH-107.
- The fixture stores refs and public state only; it must not inline raw payloads, DOM, HAR, screenshots, videos, cookies, tokens, viewer endpoints, local paths, or provider-private objects.
- Conformance generates the same successful read-only Run Record through the local Run Record store and verifies it matches the golden fixture after fixture metadata is stripped.
- Conformance verifies the golden fixture can seed a file-backed Run Record store and be consumed by the existing run, result, and evidence-ref query helpers.
- Documentation identifies the fixture as the reusable downstream input for the later GH-109 smoke without adding the smoke itself.

## Non-Goals

- Do not add API/CLI smoke; GH-109 owns it.
- Do not add write-side action request guardrail; GH-110 owns it.
- Do not add App UI, SDK/MCP full entrypoints, generated clients, history search, database/storage backends, hosted storage, real executor, complex recovery, Harbor/Lode/App repository changes, raw evidence retrieval, or true writes.

## Suite Applicability

- Suite path: minimal
- Required artifacts: .loom/specs/GH-108/spec.md, .loom/specs/GH-108/plan.md, and .loom/specs/GH-108/implementation-contract.md
- Evidence-map: present for review/merge-ready evidence binding.
- Full-suite artifacts not applicable: suite-index.md, research.md, contracts.md, readiness-checklist.md, consistency-analysis, execution breakdown.
- Rationale: This Work Item freezes one representative fixture and conformance check over already-established contracts; it does not add new API surface, smoke entrypoints, storage backends, execution loops, or write behavior.
- Consumer boundary: Review and PR Ready should consume ADR 0003/0005/0007/0008, the existing GH-101 through GH-107 contracts, the golden fixture, conformance output, GH-108 carriers, local command results, PR metadata readback, and hosted checks.
- Recheck condition: Require broader suite artifacts when a later PR adds API/CLI smoke, write guardrails, generated clients, App UI, database storage, hosted service storage, real execution, or true-write behavior.

## Acceptance

- `pnpm --filter @webenvoy/schemas test` passes.
- `pnpm --filter @webenvoy/conformance typecheck` passes.
- `pnpm --filter @webenvoy/conformance test` passes.
- `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm lint` pass.
- `pnpm conformance` passes and reports the golden Run Record fixture coverage.
- `git diff --check` passes.
- `jq empty packages/schemas/fixtures/golden-read-only-run-record.fixture.json .loom/bootstrap/init-result.json .loom/specs/GH-108/build-evidence.json` passes.
- `loom doctor`, `loom verify`, `loom fact-chain`, `loom suite validate`, `loom suite carrier validate`, `loom suite evidence validate`, and packaged Loom build flow pass for GH-108 before PR Ready.
- PR body/head readback matches Work Item `GH-108`, branch `work/GH-108-golden-run-fixture`, repository `WebEnvoy/WebEnvoy`, and current head after every push.
- No API/CLI smoke, write guardrail, App UI, SDK/MCP full entrypoint, history search, storage backend, real executor, Harbor/Lode/App edit, raw evidence retrieval, or true write is introduced.
