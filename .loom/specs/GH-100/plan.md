# Plan

## Implementation

1. Add `packages/conformance` workspace package for repository-level fixture and Run Record checks.
2. Add a root `pnpm conformance` command that builds the core runtime and runs the conformance package self-check.
3. Validate local schema metadata and fixture-to-schema version bindings using structured JSON reads.
4. Exercise the existing file-backed Run Record store with successful read-only and admission-failure fixture paths.
5. Assert refs-only storage boundaries for Run Records.
6. Update README with the conformance command.
7. Add GH-100 item-specific Loom work item, progress, status, spec, task carrier, evidence-map, implementation contract, and build evidence.
8. Run local validation and refresh evidence before PR creation.

## Constraints

- Keep the conformance package dependency-free except for the workspace dependency on `@webenvoy/core-runtime`.
- Consume existing schemas, fixtures, and Run Record store behavior; do not create a second contract truth.
- Do not add Ajv, generated types, OpenAPI, API routes, database/ORM/migration tooling, hosted storage, runtime frameworks, or test frameworks in this PR.
- Do not change API Server behavior.
- Do not modify Harbor, Lode, App, or other repositories.
- Do not mark FR #94 complete until #100 post-merge closeout evidence exists and #97 through #100 are confirmed closed.

## Validation

- `pnpm install --lockfile-only`
- `pnpm conformance`
- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm lint`
- `git diff --check`
- `jq empty .loom/bootstrap/init-result.json .loom/specs/GH-100/build-evidence.json`
- `loom doctor --target . --json`
- `loom verify --target . --json`
- `loom fact-chain --target . --json`
- `loom suite validate --target . --item GH-100 --json`
- `loom suite carrier validate --target . --item GH-100 --json`
- `loom suite evidence validate --target . --item GH-100 --json`
- packaged `loom_flow.py flow build --target . --item GH-100 --build-evidence .loom/specs/GH-100/build-evidence.json`
- PR body/head readback after push and PR creation.

## Closeout Boundary

- This PR should reach PR Ready for Work Item #100 only.
- Merge-ready, semantic review, merge, issue closeout, and FR #94 closeout require current-head review, hosted checks, merge commit, and post-merge evidence.
