# Plan

## Implementation

1. Replace the implicit rank-based Run Record status progression with an explicit lifecycle transition table.
2. Export lifecycle transition metadata from `packages/core`.
3. Narrow creation-time override statuses to valid pre-run or admission-failure terminal states.
4. Extend `packages/core/src/self-check.ts` with skipped-transition, legal cancellation, and terminal rejection checks.
5. Update `packages/conformance/src/self-check.ts` to use the legal `pending -> admitted -> running -> succeeded` path.
6. Add GH-102 item-specific Loom work item, progress, status, spec, task carrier, evidence-map, implementation contract, and build evidence.
7. Run local validation and refresh evidence before PR creation.

## Constraints

- Keep implementation dependency-free and limited to the existing core/conformance packages.
- Preserve existing JSON Schema public status names and ADR 0005 wording.
- Do not add API Server routes, execution workers, retry/recovery orchestration, result envelope rewrites, Lode/Harbor consumption, generated types, OpenAPI, database/ORM/migration tooling, hosted storage, SDK/App integration, or true-write behavior in this PR.
- Do not modify Harbor, Lode, App, or other repositories.
- Do not mark FR #95 complete while later Work Items and Lode #89 remain open.

## Validation

- `pnpm --filter @webenvoy/core-runtime test`
- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm lint`
- `pnpm conformance`
- `git diff --check`
- `jq empty .loom/bootstrap/init-result.json .loom/specs/GH-102/build-evidence.json`
- `loom doctor --target . --json`
- `loom verify --target . --json`
- `loom fact-chain --target . --json`
- `loom suite validate --target . --item GH-102 --json`
- `loom suite carrier validate --target . --item GH-102 --json`
- `loom suite evidence validate --target . --item GH-102 --json`
- packaged `loom_flow.py flow build --target . --item GH-102 --build-evidence .loom/specs/GH-102/build-evidence.json`
- PR body/head readback after push and PR creation.

## Closeout Boundary

- This PR should reach PR Ready for Work Item #102 only.
- Merge-ready, semantic review, merge, issue closeout, and FR #95 closeout require current-head review, hosted checks, merge commit, post-merge evidence, and remaining #95 Work Item/dependency completion.
