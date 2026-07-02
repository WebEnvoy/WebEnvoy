# Spec

## Goal

Provide the first minimal run query interface so Core/API consumers can read one Run Record through a stable App-facing shape.

## Required Behavior

- Core exports a run query schema version.
- Core exports a projection helper that converts a Run Record into a public run summary.
- Core exports a store-backed helper that returns either the run summary or a structured query failure.
- The run summary includes `run_id`, current status, timeline timestamps, task intent ref, entrypoint ref, capability ref, package ref, admission decision/action risk/resource refs, runtime binding refs, and terminal summary.
- Terminal summary includes terminal status, terminal timestamp, result ref, retention state, and only a compact failure category/code/phase summary when present.
- Query failures use the public failure taxonomy with `phase=query`; invalid run ids do not throw to API consumers.
- API Server exposes `GET /runs/:run_id`.
- API Server returns the same Core run summary shape for existing runs.
- API Server returns `404` with structured `run_not_found` for missing runs.
- API Server returns `400` with structured `run_id_invalid` for malformed encoded run ids.
- API Server returns `503` with structured `run_store_unavailable` when no Run Record store is bound.
- API Server can bind a local Run Record store from `WEBENVOY_RUN_RECORD_DIR` for later smoke reuse.
- Core and API Server self-checks cover the successful query and safe failure paths.

## Non-Goals

- Do not add result/evidence refs detail query endpoints; GH-107 owns them.
- Do not add the golden run fixture; GH-108 owns it.
- Do not add API/CLI smoke; GH-109 owns it.
- Do not add write-side action request guardrail; GH-110 owns it.
- Do not add App UI, SDK/MCP full entrypoints, history list/search/filtering, database migrations, ORM, hosted storage, real executor, complex recovery, Harbor/Lode/App repository changes, raw evidence retrieval, or true writes.

## Suite Applicability

- Suite path: minimal
- Required artifacts: .loom/specs/GH-106/spec.md, .loom/specs/GH-106/plan.md, and .loom/specs/GH-106/implementation-contract.md
- Evidence-map: present for review/merge-ready evidence binding.
- Full-suite artifacts not applicable: suite-index.md, research.md, contracts.md, readiness-checklist.md, consistency-analysis, execution breakdown.
- Rationale: This Work Item adds one narrow Core/API read path over existing Run Record truth and targeted self-checks without adding result/evidence detail retrieval, CLI smoke, App integration, storage backends, or write behavior.
- Consumer boundary: Review and PR Ready should consume ADR 0003/0005/0006/0007/0008, the Core run-query helper, API server route, targeted self-check output, GH-106 carriers, local command results, PR metadata readback, and hosted checks.
- Recheck condition: Require broader suite artifacts when a later PR adds result/evidence query, golden fixtures, CLI/API smoke, write guardrails, generated clients, App UI, database storage, hosted service storage, real execution, or true-write behavior.

## Acceptance

- `pnpm --filter @webenvoy/core-runtime typecheck` passes.
- `pnpm --filter @webenvoy/core-runtime test` passes.
- `pnpm --filter @webenvoy/api-server typecheck` passes.
- `pnpm --filter @webenvoy/api-server test` passes.
- `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm lint` pass.
- `git diff --check` passes.
- `loom doctor`, `loom verify`, `loom fact-chain`, `loom suite validate`, `loom suite carrier validate`, `loom suite evidence validate`, and packaged Loom build flow pass for GH-106 before PR Ready.
- PR body/head readback matches Work Item `GH-106`, branch `work/GH-106-run-query`, repository `WebEnvoy/WebEnvoy`, and current head after every push.
- No result/evidence detail query, golden fixture, API/CLI smoke, write guardrail, App UI, SDK/MCP full entrypoint, history search, storage backend, real executor, Harbor/Lode/App edit, raw evidence retrieval, or true write is introduced.
