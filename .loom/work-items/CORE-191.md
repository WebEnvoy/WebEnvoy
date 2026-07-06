# CORE-191

## Static Facts

- Item ID: CORE-191
- Goal: Accept Harbor real identity environment and runtime session public refs/facts into Core admission and Run Record without storing private browser material.
- Scope: Covers Core FR #187 and Work Items #191/#192/#193/#194/#207; excludes Harbor #160 live evidence, real accounts, passwords, cookies, tokens, profile storage, raw browser endpoints, App UI, Lode site execution, true writes, merge, issue closeout, and current pointer retire.
- Execution Path: work/core-187-real-identity-session
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-191.md
- Review Entry: .loom/reviews/CORE-191.json
- Validation Entry: pnpm --filter @webenvoy/core-runtime test; pnpm --filter @webenvoy/schemas test; pnpm conformance; pnpm typecheck; git diff --check; loom fact-chain --target . --json; loom verify --target . --json; loom suite validate/carrier/evidence --target . --item CORE-191 --json
- Closing Condition: PR ready for review with metadata covering #187/#191/#192/#193/#194/#207 and hosted checks started; merge/closeout/current pointer retire are out of scope for this execution thread.

## Covered Work Items

- #191 accepts Harbor identity environment refs/facts.
- #192 accepts Harbor runtime session refs/facts and consumes lifecycle/control status.
- #193 maps identity/session/page/resource blockers into admission failures or user-action state.
- #194 rejects private Harbor material before persistence.
- #207 records Core task run boundaries so manual/agent/direct browser sessions do not become Run Records unless a Core task is submitted.

## Associated Artifacts

- packages/core/src/harbor-admission.ts
- packages/core/src/task-submission.ts
- packages/core/src/run-record-store.ts
- packages/core/src/run-query.ts
- packages/core/src/self-check.ts
- packages/schemas/schemas/run-record.schema.json
- packages/schemas/fixtures/real-identity-session-run-record.fixture.json
- packages/conformance/src/self-check.ts
- .loom/specs/CORE-191/**
