# Spec

## Goal

Provide minimal result and evidence-ref query interfaces so Core/API consumers can read terminal result/failure state and evidence ref availability from existing Run Record truth.

## Required Behavior

- Core exports result query and evidence refs query schema versions.
- Core exports projections that convert a Run Record into public result and evidence-ref query envelopes.
- Result query returns terminal Result Envelope state when available, structured failure reason when present, evidence refs, and explicit unavailable/redacted/expired/access-denied states.
- Evidence-ref query returns admission and terminal evidence refs with source classification and public state.
- Query helpers return structured `phase=query` failures for invalid run ids and missing runs.
- API Server exposes `GET /runs/:run_id/result`.
- API Server exposes `GET /runs/:run_id/evidence-refs`.
- API Server returns `404` with structured `run_not_found` for missing runs.
- API Server returns `400` with structured `run_id_invalid` for malformed encoded run ids.
- API Server returns `503` with structured `run_store_unavailable` when no Run Record store is bound.
- Core and API Server self-checks cover success result query, failure reason query, evidence refs query, redacted state, missing run, and invalid run id paths.

## Non-Goals

- Do not add the golden run fixture; GH-108 owns it.
- Do not add API/CLI smoke; GH-109 owns it.
- Do not add write-side action request guardrail; GH-110 owns it.
- Do not retrieve raw evidence, screenshots, HAR, DOM, viewer URLs, cookies, tokens, or provider-private objects.
- Do not add App UI, SDK/MCP full entrypoints, history list/search/filtering, database migrations, ORM, hosted storage, real executor, complex recovery, Harbor/Lode/App repository changes, or true writes.

## Suite Applicability

- Suite path: minimal
- Required artifacts: .loom/specs/GH-107/spec.md, .loom/specs/GH-107/plan.md, and .loom/specs/GH-107/implementation-contract.md
- Evidence-map: present for review/merge-ready evidence binding.
- Full-suite artifacts not applicable: suite-index.md, research.md, contracts.md, readiness-checklist.md, consistency-analysis, execution breakdown.
- Rationale: This Work Item adds one narrow Core/API read path over existing Run Record refs and targeted self-checks without adding fixtures, CLI smoke, App integration, storage backends, raw evidence access, or write behavior.
- Consumer boundary: Review and PR Ready should consume ADR 0003/0005/0007/0008, the Core result-query helper, API server routes, targeted self-check output, GH-107 carriers, local command results, PR metadata readback, and hosted checks.
- Recheck condition: Require broader suite artifacts when a later PR adds golden fixtures, CLI/API smoke, write guardrails, generated clients, App UI, database storage, hosted service storage, real execution, or true-write behavior.

## Acceptance

- `pnpm --filter @webenvoy/core-runtime typecheck` passes.
- `pnpm --filter @webenvoy/core-runtime test` passes.
- `pnpm --filter @webenvoy/api-server typecheck` passes.
- `pnpm --filter @webenvoy/api-server test` passes.
- `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm lint` pass.
- `git diff --check` passes.
- `loom doctor`, `loom verify`, `loom fact-chain`, `loom suite validate`, `loom suite carrier validate`, `loom suite evidence validate`, and packaged Loom build flow pass for GH-107 before PR Ready.
- PR body/head readback matches Work Item `GH-107`, branch `work/GH-107-result-evidence-query`, repository `WebEnvoy/WebEnvoy`, and current head after every push.
- No golden fixture, API/CLI smoke, write guardrail, App UI, SDK/MCP full entrypoint, history search, storage backend, real executor, Harbor/Lode/App edit, raw evidence retrieval, or true write is introduced.
