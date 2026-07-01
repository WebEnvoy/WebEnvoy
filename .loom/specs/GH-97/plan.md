# Plan

## Implementation

1. Add root pnpm workspace, package scripts, TypeScript base config, and minimal ignore rules.
2. Add `packages/api-server` with native Node.js HTTP server, CLI entrypoint, and self-check.
3. Update README with `pnpm install`, `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm lint`, and API Server start instructions.
4. Add GH-97 item-specific Loom work item, progress, spec, task carrier, and build evidence.
5. Run local validation and refresh evidence before PR creation.

## Constraints

- Use Node.js standard library for HTTP.
- Do not add Express, Fastify, Hono, test frameworks, lint frameworks, OpenAPI tooling, database/storage tooling, or schema validators in this PR.
- Keep `packages/api-server` under the API Server skeleton boundary only.
- Do not modify Harbor, Lode, App, or other repositories.
- Do not mark FR #94 complete until #98, #99, and #100 also close.

## Validation

- `pnpm install`
- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm lint`
- `git diff --check`
- `loom suite validate --target . --item GH-97 --json`
- `loom suite carrier validate --target . --item GH-97 --json`
- `loom build --target . --item GH-97 --build-evidence .loom/specs/GH-97/build-evidence.json --json`
- PR body/head readback after push and PR creation.

## Closeout Boundary

- This PR should reach PR Ready for Work Item #97 only.
- Merge-ready, semantic review, merge, issue closeout, and FR/milestone closeout require current-head review, hosted checks, merge commit, and post-merge evidence.

