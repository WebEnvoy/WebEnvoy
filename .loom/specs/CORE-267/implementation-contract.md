# CORE-267 Implementation Contract

## Write Ownership

- `packages/core/src/lode-admission.ts`
- `packages/core/src/runtime-task-chain.ts`
- `packages/api-server/src/server.ts`
- `packages/api-server/src/runtime-task-submit-self-check.ts`
- `packages/api-server/src/runtime-process-self-check.ts`
- Focused Core/API tests required by these behaviors
- `.loom/work-items/CORE-267.md`
- `.loom/progress/CORE-267.md`
- `.loom/specs/CORE-267/**`
- `.loom/status/current.md`
- `.loom/bootstrap/init-result.json`

## Read Scope

- Core task submission, Lode admission, Harbor admission, and Run Record query paths.
- Core #267/#243, Harbor #245 and merged PR #249, and Lode #262 at canonical commit `e36a4a7`.

## Acceptance

- Explicit public query reaches Harbor only after Lode and Harbor admission.
- Snapshot/resource facts cannot create a successful run.
- Completed Harbor output must satisfy canonical Lode pin/ref/post-check requirements.
- Execution failures are terminal and correctly attributed; raw/sensitive data is not persisted.
- Tests exercise success, allowlist drift, unavailable operation, and missing refs/post-check.

