# Plan

## Implementation

1. Read Core contracts and Harbor `origin/main` runtime/page-scene/viewer facts.
2. Add a narrow Core `harbor-admission` helper that consumes only Harbor public ref facts.
3. Require Harbor runtime and page-scene refs in `acceptReadOnlyTaskSubmission` after Lode admission and before accepted Run Record creation.
4. Map runtime/profile/provider/viewer/snapshot/refmap/source-trace refs into `admission.runtime_binding_refs` and top-level `runtime_binding_refs`.
5. Map Harbor evidence refs into `admission.evidence_refs` and top-level `evidence_refs`.
6. Create failed Run Records for trusted Task Intent when Harbor runtime or evidence refs are missing, unavailable, expired/stale, or denied.
7. Extend core self-check and conformance checks for Harbor ref binding behavior.
8. Add GH-104 item-specific Loom work item, progress, status, spec, task carrier, evidence-map, implementation contract, and build evidence.
9. Run local validation and refresh evidence before PR creation.

## Constraints

- Keep implementation dependency-free and limited to existing core/schemas/conformance packages.
- Consume Harbor fields exactly from public `CoreRuntimeFacts` and `CoreSceneReference`; do not invent Harbor private fields.
- Do not add Harbor package imports, SDK calls, runtime sessions, browser launches, evidence retrieval, or App integration.
- Do not add GH-105 result/failure envelope output or query APIs.
- Do not modify Harbor, Lode, App, or other repositories.
- Do not mark FR #95 complete while GH-105 remains open.

## Validation

- `pnpm --filter @webenvoy/core-runtime typecheck`
- `pnpm --filter @webenvoy/core-runtime test`
- `pnpm --filter @webenvoy/schemas test`
- `pnpm conformance`
- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm lint`
- `git diff --check`
- `jq empty .loom/specs/GH-104/build-evidence.json`
- `loom doctor --target . --json`
- `loom verify --target . --json`
- `loom fact-chain --target . --json`
- `loom suite validate --target . --item GH-104 --json`
- `loom suite carrier validate --target . --item GH-104 --json`
- `loom suite evidence validate --target . --item GH-104 --json`
- packaged `loom_flow.py flow build --target . --item GH-104 --build-evidence .loom/specs/GH-104/build-evidence.json`
- PR body/head readback after push and PR creation.

## Closeout Boundary

- This PR should reach PR Ready for Work Item #104 only.
- Merge-ready, semantic review, merge, issue closeout, and FR #95 closeout require current-head review, hosted checks, merge commit, post-merge evidence, and GH-105 completion.
