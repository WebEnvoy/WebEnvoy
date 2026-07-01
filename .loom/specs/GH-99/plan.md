# Plan

## Implementation

1. Add `packages/core` workspace package for Core runtime helpers.
2. Implement a no-dependency file-backed Run Record store.
3. Enforce safe run ids, monotonic status transitions, terminal timestamps, failed-run failure data, and refs-only storage boundaries.
4. Add a self-check that writes and reloads successful and failed Run Records in a temporary directory.
5. Update README with the core runtime self-check command.
6. Add GH-99 item-specific Loom work item, progress, status, spec, task carrier, evidence-map, implementation contract, and build evidence.
7. Run local validation and refresh evidence before PR creation.

## Constraints

- Keep the store dependency-free.
- Store public Run Record JSON refs and summaries only.
- Do not add Ajv, generated types, OpenAPI, API routes, database/ORM/migration tooling, hosted storage, runtime frameworks, or test frameworks in this PR.
- Do not change API Server behavior.
- Do not modify Harbor, Lode, App, or other repositories.
- Do not mark FR #94 complete until #100 also closes.

## Validation

- `pnpm install --lockfile-only`
- `pnpm --filter @webenvoy/core-runtime test`
- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm lint`
- `git diff --check`
- `jq empty .loom/bootstrap/init-result.json .loom/specs/GH-99/build-evidence.json`
- `loom fact-chain --target . --json`
- `loom suite validate --target . --item GH-99 --json`
- `loom suite carrier validate --target . --item GH-99 --json`
- `loom suite evidence validate --target . --item GH-99 --json`
- packaged `loom_flow.py flow build --target . --item GH-99 --build-evidence .loom/specs/GH-99/build-evidence.json`
- PR body/head readback after push and PR creation.

## Closeout Boundary

- This PR should reach PR Ready for Work Item #99 only.
- Merge-ready, semantic review, merge, issue closeout, and FR/milestone closeout require current-head review, hosted checks, merge commit, and post-merge evidence.
