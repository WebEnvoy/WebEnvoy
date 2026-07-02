# Spec

## Goal

Make Core produce structured success Result Envelopes and structured failure reasons for terminal read-only runs while keeping Run Record as durable truth and preserving refs-only boundaries.

## Required Behavior

- Core exports a result envelope schema version and helper for terminal success output.
- Core exports a helper for terminal structured failure output.
- Success output advances an existing Run Record to `succeeded`.
- Success output records `result_ref`, `evidence_refs`, and `retention_state` in the Run Record.
- Success output returns a public envelope with `schema_version`, `run_record_ref`, `ok`, `outcome`, `terminal`, `result_ref`, `result_kind`, `capability_ref`, optional `package_ref`, optional public `data`, optional `projection_ref`, optional raw/source refs, `evidence_refs`, and `retention_state`.
- Failure output advances an existing Run Record to `failed` by default.
- Failure output records structured `failure` with `category`, `code`, `phase`, and `recovery_hint` in the Run Record.
- Failure output returns a public envelope with `ok=false`, terminal outcome, failure reason, safe refs, and retention state.
- Result data rejects private/raw field names such as DOM/HAR/screenshot/video, cookies, tokens, local paths, runtime session internals, CDP/VNC/viewer URLs, raw evidence bodies, full DOM, network bodies, or provider private objects.
- Result envelope schema requires `ok` and constrains failure category/phase to the same public taxonomy as Run Record.
- Fixtures include both success and failure Result Envelopes.
- Core self-check covers success envelope, failure envelope, Run Record terminal fields, and raw/private result data rejection.
- Conformance covers success and failure envelope helpers plus the existing admission-failure Run Record fixture.

## Non-Goals

- Do not implement API query routes, App/UI integration, CLI/MCP/SDK-facing query, or FR #96 smoke.
- Do not implement a browser/runtime executor, Harbor runtime calls, evidence retrieval, or Harbor package imports.
- Do not modify Harbor, Lode, App, or other repositories.
- Do not copy Lode package bodies, fixtures, normalizers, validators, or post-check code.
- Do not add a result store, database, ORM, migration tool, hosted service storage, or multi-backend abstraction.
- Do not implement real writes, write reconciliation, complex retry/recovery, or generic browser agent loops.

## Suite Applicability

- Suite path: minimal
- Required artifacts: .loom/specs/GH-105/spec.md, .loom/specs/GH-105/plan.md, and .loom/specs/GH-105/implementation-contract.md
- Evidence-map: present for review/merge-ready evidence binding.
- Full-suite artifacts not applicable: suite-index.md, research.md, contracts.md, readiness-checklist.md, consistency-analysis, execution breakdown.
- Rationale: This Work Item is a narrow Core runtime PR that adds terminal result/failure output helpers and fixture/self-check/conformance coverage without adding query routes, generated clients, live Harbor/Lode calls, storage backends, or cross-repo edits.
- Consumer boundary: Review and PR Ready should consume ADR 0003/0005/0007/0008, the Core result-envelope helper, Result Envelope schema/fixtures, self-check/conformance output, GH-105 carriers, local command results, PR metadata readback, and hosted checks.
- Recheck condition: Require broader suite artifacts when a later PR adds API query routes, App/API smoke, evidence retrieval, generated types, CLI/MCP/SDK/App integration, database storage, hosted service storage, true execution, or true-write guardrails.

## Acceptance

- `pnpm --filter @webenvoy/core-runtime test` passes.
- `pnpm --filter @webenvoy/schemas test` passes.
- `pnpm conformance`, `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm lint` pass.
- `git diff --check` passes.
- `loom doctor`, `loom verify`, `loom fact-chain`, `loom suite validate`, `loom suite carrier validate`, `loom suite evidence validate`, and packaged Loom build flow pass for GH-105 before PR Ready.
- PR body/head readback matches Work Item `GH-105`, branch `work/GH-105-result-envelope`, repository `WebEnvoy/WebEnvoy`, and current head after every push.
- No API query route, App/UI integration, Harbor/Lode/App edit, live Harbor call, Lode package body copy, result store, hosted storage, generated client, real execution loop, complex recovery, or true-write behavior is introduced.
