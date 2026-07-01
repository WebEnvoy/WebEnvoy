# Plan

## Implementation

1. Add a narrow `packages/core/src/task-submission.ts` helper for read-only Task Intent v0 parsing and acceptance.
2. Reuse the existing file-backed Run Record store for durable accepted admission records.
3. Reject invalid input and private/raw fields before Run Record creation.
4. Export the helper and related types from `packages/core/src/index.ts`.
5. Extend `packages/core/src/self-check.ts` with accepted submission and invalid private-field checks.
6. Add GH-101 item-specific Loom work item, progress, status, spec, task carrier, evidence-map, implementation contract, and build evidence.
7. Run local validation and refresh evidence before PR creation.

## Constraints

- Keep the implementation dependency-free and limited to the existing core runtime package.
- Store references and summaries only; do not persist raw browser/runtime/private material.
- Do not add API Server routes, CLI/MCP/SDK/App integration, result projection, execution lifecycle, generated types, OpenAPI, database/ORM/migration tooling, hosted storage, or test frameworks in this PR.
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
- `jq empty .loom/bootstrap/init-result.json .loom/specs/GH-101/build-evidence.json`
- `loom doctor --target . --json`
- `loom verify --target . --json`
- `loom fact-chain --target . --json`
- `loom suite validate --target . --item GH-101 --json`
- `loom suite carrier validate --target . --item GH-101 --json`
- `loom suite evidence validate --target . --item GH-101 --json`
- packaged `loom_flow.py flow build --target . --item GH-101 --build-evidence .loom/specs/GH-101/build-evidence.json`
- PR body/head readback after push and PR creation.

## Closeout Boundary

- This PR should reach PR Ready for Work Item #101 only.
- Merge-ready, semantic review, merge, issue closeout, and FR #95 closeout require current-head review, hosted checks, merge commit, post-merge evidence, and remaining #95 Work Item/dependency completion.
