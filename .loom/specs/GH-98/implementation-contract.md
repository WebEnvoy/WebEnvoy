# Implementation Contract

## Work Item

- Item: GH-98
- Execution Entry: implementation/schema-fixtures-v0

## Approved Spec

- Spec Path: .loom/specs/GH-98/spec.md
- Spec Review Entry: .loom/reviews/GH-98.spec.json

## Implementation Scope

- In Scope: `packages/schemas` JSON Schema carriers, representative fixtures, no-dependency schema self-check, root workspace script inclusion, README schema command documentation, lockfile importer metadata, GH-98 Loom carriers, and GH-98 review artifacts.
- Out Of Scope: Run Record persistence implementation, API submission/query routes, admission runtime execution, Ajv validation, generated TypeScript types, OpenAPI, CLI/MCP/SDK/App integration, Harbor/Lode/App repository changes, true writes, issue closure, PR merge, and FR #94 closeout.

## Validation Plan

- Automated Checks: `pnpm install --lockfile-only`; `pnpm build`; `pnpm typecheck`; `pnpm --filter @webenvoy/schemas test`; `pnpm test`; `pnpm lint`; `git diff --check`; `jq empty .loom/bootstrap/init-result.json .loom/specs/GH-98/build-evidence.json packages/schemas/schemas/*.schema.json`; `loom doctor --target . --json`; `loom verify --target . --json`; `loom fact-chain --target . --json`; `loom suite validate --target . --item GH-98 --json`; `loom suite carrier validate --target . --item GH-98 --json`; `loom suite evidence validate --target . --item GH-98 --json`; packaged `loom_flow.py flow build --target . --item GH-98 --build-evidence .loom/specs/GH-98/build-evidence.json`; PR metadata preflight.
- Manual Verification: Confirm PR #113 body has `Loom Work Item: GH-98`, branch `work/GH-98-schema-fixtures`, the current head SHA, and repository `WebEnvoy/WebEnvoy`; confirm FR #94 remains open until #99 and #100 are complete.

## Risks And Rollback

- Risks: This PR establishes early contract carrier names and field vocabulary that #99 and #100 will consume, but it deliberately avoids runtime validators, generated consumers, persistence, and API behavior.
- Rollback Boundary: Revert PR #113 to remove `packages/schemas` and GH-98 carriers; do not close #94 or #98 without post-merge closeout evidence.

## Host Binding

- Pull Request: https://github.com/WebEnvoy/WebEnvoy/pull/113
- Reviewed Head: pending
