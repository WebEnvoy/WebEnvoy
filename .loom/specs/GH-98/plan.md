# Plan

## Implementation

1. Add `packages/schemas` workspace package with TypeScript self-check scaffolding.
2. Add task intent, Run Record, result envelope, and evidence ref JSON Schema files derived from ADR 0003/0005/0006/0007/0008.
3. Add representative fixtures for read-only submit, admission failure Run Record, successful result envelope, and redacted evidence ref.
4. Update root workspace scripts so build/typecheck/test/lint include the schemas package.
5. Update README with the schemas self-check command.
6. Add GH-98 item-specific Loom work item, progress, status, spec, task carrier, evidence-map, and build evidence.
7. Run local validation and refresh evidence before PR creation.

## Constraints

- Keep the self-check dependency-free.
- Do not add Ajv, generated types, OpenAPI, persistence tooling, test frameworks, or new runtime frameworks in this PR.
- Do not change API Server behavior.
- Do not modify Harbor, Lode, App, or other repositories.
- Do not mark FR #94 complete until #99 and #100 also close.

## Validation

- `pnpm install --lockfile-only`
- `pnpm build`
- `pnpm typecheck`
- `pnpm --filter @webenvoy/schemas test`
- `pnpm test`
- `pnpm lint`
- `git diff --check`
- `loom fact-chain --target . --json`
- `loom suite validate --target . --item GH-98 --json`
- `loom suite carrier validate --target . --item GH-98 --json`
- `loom suite evidence validate --target . --item GH-98 --json`
- packaged `loom_flow.py flow build --target . --item GH-98 --build-evidence .loom/specs/GH-98/build-evidence.json`
- PR body/head readback after push and PR creation.

## Closeout Boundary

- This PR should reach PR Ready for Work Item #98 only.
- Merge-ready, semantic review, merge, issue closeout, and FR/milestone closeout require current-head review, hosted checks, merge commit, and post-merge evidence.
