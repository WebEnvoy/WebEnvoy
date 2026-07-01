# Spec

## Goal

Make Core admission consume the first real Lode sample package identity and resource requirement declaration without copying Lode package bodies or advancing Harbor/result/API scope.

## Required Behavior

- Core accepts a static Lode package admission contract shaped from Lode main fields: `package_ref`, `lock_ref`, `capability_id`, `operation_mode`, `version`, and `resource_requirements`.
- Accepted read-only submission requires a `package_ref` and Lode package admission contract.
- Core maps existing `TaskIntentEnvelope.capability.ref/version` to Lode `capability_id/version`; the accepted fixture uses `lode:capability/read-public-page` and version `0.1.0`.
- Core validates that the requested `package_ref` equals Lode `package_ref`.
- Core validates that Lode `lock_ref` is present but does not store or load a package lock body.
- Core validates that Lode `operation_mode` is known and `read`; non-read modes return `true_write_deferred` and create a failed Run Record.
- Core validates that Lode `resource_requirements.package_ref` and `operation_mode` match the package, that at least one `resource_requirement_profiles[]` entry exists, and that declared `required_harbor_facts[]` entries are public Harbor-owned facts.
- Core maps the Task Intent `resource_requirement_refs` to Lode `resource_requirements_id`; missing or mismatched refs return `resource_requirement_missing`.
- Core rejects Lode contracts containing forbidden runtime identity, credential, local path, raw evidence, production payload, or user business data field names.
- Valid read-only admission records `admission.resource_requirement_refs` in the Run Record.
- Trusted Task Intent with invalid Lode contract creates a terminal failed Run Record with structured failure instead of silently accepting or creating no record.
- Core self-check covers accepted Lode admission, private-field request failure without a Run Record, invalid Lode contract failure with a failed Run Record, and non-read Lode operation failure with a failed Run Record.
- Schema/conformance fixtures align to Lode main sample package refs from commit `d9591e8bf0b39250b22362a276bf2b3ea74e115e`.
- GH-103 item-specific Loom carriers bind the Work Item, branch, scope, Lode source facts, and validation plan.

## Non-Goals

- Do not implement Harbor runtime/evidence refs, live Harbor fact matching, or runtime binding; those remain GH-104.
- Do not implement result envelope/failure reason output beyond existing Run Record failure fields; that remains GH-105.
- Do not add API query/smoke/App integration; those remain GH-106 through GH-110.
- Do not load, copy, persist, or validate full Lode package bodies, fixtures, validator code, registry stores, schemas, normalizers, or post-check bodies inside Core.
- Do not implement hosted registry, marketplace, package install/sync/pin/rollback, execution workers, retry/recovery orchestration, database/ORM/migration tooling, generated clients, OpenAPI, SDKs, or true writes.
- Do not modify Harbor, Lode, App, or other repositories.
- Do not claim FR #95 complete; GH-104 and GH-105 remain open.

## Suite Applicability

- Suite path: minimal
- Required artifacts: .loom/specs/GH-103/spec.md, .loom/specs/GH-103/plan.md, and .loom/specs/GH-103/implementation-contract.md
- Evidence-map: present for review/merge-ready evidence binding.
- Full-suite artifacts not applicable: suite-index.md, research.md, contracts.md, readiness-checklist.md, consistency-analysis, execution breakdown.
- Rationale: This Work Item is a narrow Core runtime PR that adds static Lode ref/resource admission checks and local self-check/conformance coverage without adding live runtime matching, result projection, query APIs, generated clients, storage backends, or cross-repo edits.
- Consumer boundary: Review and PR Ready should consume the Lode source facts from `origin/main` commit `d9591e8`, the new Core `lode-admission` helper, Run Record admission schema, aligned fixtures, self-check/conformance output, GH-103 carriers, local command results, PR metadata readback, and hosted checks.
- Recheck condition: Require broader suite artifacts when a later PR adds Harbor live facts, API submit/query routes, result envelope projection, evidence retrieval, CLI/MCP/SDK/App integration, generated types, database storage, hosted service storage, or true-write guardrails.

## Acceptance

- `pnpm --filter @webenvoy/core-runtime test` passes.
- `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `pnpm conformance` pass.
- `git diff --check` passes.
- `loom doctor`, `loom verify`, `loom fact-chain`, `loom suite validate`, `loom suite carrier validate`, `loom suite evidence validate`, and packaged Loom build flow pass for GH-103 before PR Ready.
- PR body/head readback matches Work Item `GH-103`, branch `work/GH-103-resource-refs`, repository `WebEnvoy/WebEnvoy`, and current head after every push.
- No Harbor/Lode/App repository changes are made.
- No registry loader, package body copying, Harbor runtime matching, result envelope output, API query/smoke, hosted storage, generated client, or true-write behavior is introduced.
