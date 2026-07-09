# CORE-244 Implementation Contract

## Write Ownership

- `packages/core/src/runtime-task-chain.ts`
- `packages/core/src/task-submission.ts`
- `packages/core/src/index.ts`
- `packages/api-server/src/server.ts`
- `packages/api-server/src/index.ts`
- `packages/api-server/src/runtime-task-submit-self-check.ts`
- `packages/api-server/src/runtime-process-self-check.ts`
- `packages/api-server/src/self-check.ts`
- `.loom/work-items/CORE-244.md`
- `.loom/progress/CORE-244.md`
- `.loom/specs/CORE-244/**`

## Read Scope

- Core API server, task submission, Lode admission, Harbor admission, Run Record store/query code.
- Core #243/#244/#245/#246/#247/#248 GitHub issue context and milestone #13 read-only context.
- Harbor #218 and Lode #252 read-only public issue/context.

## Acceptance

- API submit path resolves Lode assets and calls Harbor local runtime API endpoints in order.
- Readiness/runtime failures produce failed Run Records and clear failure codes.
- Tests include in-process mock HTTP server coverage and a built-process API server smoke. They do not claim live Xiaohongshu/BOSS runtime evidence.
