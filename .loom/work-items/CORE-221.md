# CORE-221

## Static Facts

- Item ID: CORE-221
- Goal: Bind Core admission to real Harbor identity environment, provider, runtime session, control status refs, and real Lode Xiaohongshu/BOSS package locks for FR #220.
- Scope: Covers FR #220 and Work Items #221/#222/#223/#224; consumes Harbor #198/#203 public provider, identity, runtime, viewer/control and redacted status facts plus Lode #230 package-lock/resource contracts. Ownership is limited to Core admission/runtime record code, targeted self-checks, and CORE-221 Loom carriers.
- Execution Path: work/core-221-real-harbor-lode
- Workspace Entry: /Volumes/2T/dev/WebEnvoy/.worktrees/WebEnvoy-core-221-real-harbor-lode
- Recovery Entry: .loom/progress/CORE-221.md
- Review Entry: .loom/reviews/CORE-221.json
- Validation Entry: pnpm --filter @webenvoy/core-runtime test; pnpm --filter @webenvoy/schemas test; pnpm conformance; pnpm typecheck; git diff --check; loom fact-chain --target . --json; loom verify --target . --json; loom suite validate/carrier/evidence --target . --item CORE-221 --json; PR metadata readback/preflight after PR creation.
- Closing Condition: PR Ready only. Do not merge and do not close #220/#221/#222/#223/#224 in this worker lane.

## Covered Issues

- #220 FR: Core consumes real Harbor sessions and Lode site capabilities.
- #221 binds real identity environment, runtime session, and control owner/status refs.
- #222 admits Xiaohongshu/BOSS package refs and lock refs from Lode #230 contracts.
- #223 checks runtime admission and Lode required Harbor resource facts.
- #224 rejects private browser material and sensitive fields before Run Record persistence.

## Associated Artifacts

- packages/core/src/harbor-admission.ts
- packages/core/src/lode-admission.ts
- packages/core/src/task-submission.ts
- packages/core/src/run-record-store.ts
- packages/core/src/real-site-readonly-self-check.ts
- packages/core/src/self-check.ts
- .loom/specs/CORE-221/**
