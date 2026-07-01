# Implementation Contract

## Work Item

- Item: GH-97
- Execution Entry: implementation/api-server-minimum-skeleton

## Approved Spec

- Spec Path: .loom/specs/GH-97/spec.md
- Spec Review Entry: .loom/reviews/GH-97.spec.json

## Implementation Scope

- In Scope: pnpm/TypeScript workspace baseline, `packages/api-server` native Node.js HTTP server, `/health`, `/readiness`, structured 404/405 responses, no-framework self-check, README command documentation, and GH-97 Loom carriers.
- Out Of Scope: task submission, JSON Schema contract files, Run Record persistence, admission, result/query APIs, write guardrails, Harbor/Lode/App integration, OpenAPI, SDK/MCP/CLI implementation, issue closure, merge, and unrelated Work Items.

## Validation Plan

- Automated Checks: `pnpm install`; `pnpm build`; `pnpm typecheck`; `pnpm test`; `pnpm lint`; `git diff --check`; `jq empty .loom/bootstrap/init-result.json .loom/specs/GH-97/build-evidence.json`; `loom suite validate --target . --item GH-97 --json`; `loom suite carrier validate --target . --item GH-97 --json`; `loom suite evidence validate --target . --item GH-97 --json`; packaged `loom_flow.py flow build --target . --item GH-97 --build-evidence .loom/specs/GH-97/build-evidence.json`; PR metadata render/readback preflight.
- Manual Verification: Confirm PR #111 body has `Loom Work Item: GH-97`, branch `work/GH-97-api-server`, the current head SHA, and repository `WebEnvoy/WebEnvoy`; confirm FR #94 remains open until #98-#100 are complete.

## Risks And Rollback

- Risks: This PR creates the first Node.js workspace baseline and may influence later package layout, but it deliberately avoids runtime task execution and persistence decisions.
- Rollback Boundary: Revert PR #111 to remove the workspace skeleton and GH-97 carriers; do not close #94 or #97 without post-merge closeout evidence.

## Host Binding

- Pull Request: https://github.com/WebEnvoy/WebEnvoy/pull/111
- Reviewed Head: pending
