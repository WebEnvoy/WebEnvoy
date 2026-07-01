# Plan

## Implementation

1. Read WebEnvoy Core contracts and Lode `origin/main` package facts for `sites/example/read-public-page`.
2. Add a narrow Core `lode-admission` helper that consumes only static Lode refs and resource requirement summaries.
3. Require package ref and Lode contract checks in `acceptReadOnlyTaskSubmission` after Task Intent parsing and before accepted Run Record creation.
4. Map valid Lode resource requirement ids into `admission.resource_requirement_refs`.
5. Create failed Run Records for trusted Task Intent when Lode package/resource contracts are invalid, missing, or non-read.
6. Align Core fixtures to the Lode `read-public-page@0.1.0` sample package and `example.read-public-page.resources`.
7. Extend core self-check and conformance checks for Lode ref/resource admission behavior.
8. Add GH-103 item-specific Loom work item, progress, status, spec, task carrier, evidence-map, implementation contract, and build evidence.
9. Run local validation and refresh evidence before PR creation.

## Constraints

- Keep implementation dependency-free and limited to the existing core/schemas/conformance packages.
- Consume Lode main fields exactly from `manifest.json`, `package-lock.json`, `resource-requirements.json`, `registry/local-packages.json`, and `fixtures/core-consumption.fixture.json`; do not invent Lode-owned fields.
- Core may derive its existing `lode:capability/<capability_id>` task intent ref from Lode `capability_id`, but must keep Lode package identity in `package_ref`.
- Do not add Lode package body loading, fixture copying, validator execution, registry store ownership, schema body validation, normalizer/post-check execution, hosted registry, or marketplace behavior.
- Do not add Harbor runtime/evidence refs or live resource matching in this PR.
- Do not add result envelope output, API query/smoke, App/CLI/MCP/SDK integration, database/ORM/migration tooling, hosted storage, or true-write behavior.
- Do not modify Harbor, Lode, App, or other repositories.
- Do not mark FR #95 complete while GH-104 and GH-105 remain open.

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
- `jq empty .loom/bootstrap/init-result.json .loom/specs/GH-103/build-evidence.json`
- `loom doctor --target . --json`
- `loom verify --target . --json`
- `loom fact-chain --target . --json`
- `loom suite validate --target . --item GH-103 --json`
- `loom suite carrier validate --target . --item GH-103 --json`
- `loom suite evidence validate --target . --item GH-103 --json`
- packaged `loom_flow.py flow build --target . --item GH-103 --build-evidence .loom/specs/GH-103/build-evidence.json`
- PR body/head readback after push and PR creation.

## Closeout Boundary

- This PR should reach PR Ready for Work Item #103 only.
- Merge-ready, semantic review, merge, issue closeout, and FR #95 closeout require current-head review, hosted checks, merge commit, post-merge evidence, and remaining #95 Work Item completion.
