# CORE-221 Execution Breakdown

## U-001 Admission Spine

- Files: `packages/core/src/harbor-admission.ts`, `packages/core/src/lode-admission.ts`, `packages/core/src/task-submission.ts`.
- Goal: Bind Lode required Harbor facts to Harbor public provider/runtime/resource admission checks.
- Validation: `pnpm --filter @webenvoy/core-runtime test`.

## U-002 Run Record Privacy Guard

- File: `packages/core/src/run-record-store.ts`.
- Goal: Reject private browser material on direct Run Record create/update paths.
- Validation: `pnpm --filter @webenvoy/core-runtime test`.

## U-003 Real-Site Fixture Checks

- Files: `packages/core/src/self-check.ts`, `packages/core/src/real-site-readonly-self-check.ts`.
- Goal: Validate Xiaohongshu/BOSS package locks, runtime bindings, resource facts, provider status, and privacy boundaries.
- Validation: `pnpm --filter @webenvoy/core-runtime test`, `pnpm conformance`.

## U-004 Carrier And PR Ready

- Files: `.loom/work-items/CORE-221.md`, `.loom/progress/CORE-221.md`, `.loom/specs/CORE-221/**`.
- Goal: Keep Work Item, validation, PR metadata, and evidence chain aligned.
- Validation: Loom fact-chain, verify, suite, carrier, evidence, build, and PR metadata preflight.
