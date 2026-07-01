# Spec

## Goal

Make Core admission bind Harbor public runtime, viewer, page scene, and evidence refs without copying Harbor private fields or raw evidence.

## Required Behavior

- Core accepts Harbor public runtime facts shaped as `harbor-core-runtime-facts/v0`.
- Core accepts Harbor public page scene refs shaped as `harbor-page-scene-refs/v0`.
- Accepted read-only submission requires both valid Lode admission and valid Harbor runtime/page-scene refs.
- Core validates `runtime_session_ref`, `profile_ref`, `provider_ref`, `viewer.viewer_ref`, `fact_refs.session`, and `fact_refs.viewer`.
- Core validates active/idle runtime lifecycle before accepted Run Record creation.
- Core validates that page scene `runtime_session_ref` matches the runtime facts.
- Core validates `snapshot_ref`, optional `refmap_ref`, `source_trace_ref`, and non-empty `evidence_refs`.
- Core validates runtime availability for snapshot and evidence refs.
- Core records Harbor runtime/profile/provider/viewer/snapshot/refmap/source-trace refs in `admission.runtime_binding_refs` and top-level `runtime_binding_refs`.
- Core records Harbor evidence refs in `admission.evidence_refs` and top-level `evidence_refs`.
- Missing runtime facts create a failed Run Record with `runtime_ref_missing`.
- Unavailable Harbor scene refs create a failed Run Record using the Harbor `failure_class` as the public evidence failure code.
- Core rejects Harbor inputs containing private/raw field names such as CDP refs, viewer URLs, raw DOM/HAR/screenshot/video, cookies, tokens, local paths, provider private objects, or raw evidence bodies.
- Core self-check covers accepted Harbor binding, missing runtime ref failure, capture denied failure, and refs-only Run Record storage.
- Schema and conformance checks cover admission-level runtime/evidence refs.

## Non-Goals

- Do not implement GH-105 result/failure envelope output beyond existing Run Record failure fields.
- Do not add API query/smoke/App integration.
- Do not call Harbor runtime APIs or import Harbor packages.
- Do not modify Harbor, Lode, App, or other repositories.
- Do not save CDP/VNC endpoints, viewer URLs, profile paths, cookies, tokens, full DOM, HAR, screenshots, videos, network bodies, or raw evidence.
- Do not implement an execution loop, retry/recovery orchestration, database storage, generated clients, hosted services, or true writes.
- Do not claim FR #95 complete; GH-105 remains open.

## Suite Applicability

- Suite path: minimal
- Required artifacts: .loom/specs/GH-104/spec.md, .loom/specs/GH-104/plan.md, and .loom/specs/GH-104/implementation-contract.md
- Evidence-map: present for review/merge-ready evidence binding.
- Full-suite artifacts not applicable: suite-index.md, research.md, contracts.md, readiness-checklist.md, consistency-analysis, execution breakdown.
- Rationale: This Work Item is a narrow Core runtime PR that consumes already-merged Harbor public refs and adds local self-check/conformance coverage without adding API routes, result projection, live Harbor calls, generated clients, storage backends, or cross-repo edits.
- Consumer boundary: Review and PR Ready should consume the Harbor source facts from `origin/main` commit `8384967`, the new Core `harbor-admission` helper, Run Record admission schema, fixtures, self-check/conformance output, GH-104 carriers, local command results, PR metadata readback, and hosted checks.
- Recheck condition: Require broader suite artifacts when a later PR adds result envelope projection, query APIs, evidence retrieval, CLI/MCP/SDK/App integration, generated types, database storage, hosted service storage, or true-write guardrails.

## Acceptance

- `pnpm --filter @webenvoy/core-runtime test` passes.
- `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `pnpm conformance` pass.
- `git diff --check` passes.
- `loom doctor`, `loom verify`, `loom fact-chain`, `loom suite validate`, `loom suite carrier validate`, `loom suite evidence validate`, and packaged Loom build flow pass for GH-104 before PR Ready.
- PR body/head readback matches Work Item `GH-104`, branch `work/GH-104-harbor-refs`, repository `WebEnvoy/WebEnvoy`, and current head after every push.
- No Harbor/Lode/App repository changes are made.
- No result envelope output, API query/smoke, App integration, Harbor SDK/runtime calls, raw evidence storage, hosted storage, generated client, or true-write behavior is introduced.
