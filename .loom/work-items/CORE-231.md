# CORE-231

## Static Facts

- Item ID: CORE-231
- Goal: Deliver Core's real-site write-precheck result generation slice for FR #230.
- Scope: Covers FR #230 and Work Items #231/#232/#233/#234. Anchor Work Item is #231. Consumes Harbor #12 closed identity/runtime/evidence facts and Lode #14 closed write-precheck capability facts, but does not modify Harbor/Lode/App. Ownership is limited to Core runtime helper/self-check/export files and CORE-231 Loom carriers; shared `.loom/status/current.md` remains `no_active_item`; no unintegrated subagent output or parallel carrier writer is allowed.
- Execution Path: work/core-231-real-write-precheck
- Workspace Entry: /Volumes/2T/dev/WebEnvoy/.worktrees/WebEnvoy-core-231-real-write-precheck
- Recovery Entry: .loom/progress/CORE-231.md
- Review Entry: .loom/reviews/CORE-231.json
- Validation Entry: pnpm --filter @webenvoy/core-runtime test; pnpm --filter @webenvoy/schemas test; pnpm --filter @webenvoy/conformance test; pnpm conformance; pnpm typecheck; git diff --check; loom fact-chain --target . --json; loom verify --target . --json; loom suite validate/carrier/evidence --target . --item CORE-231 --json; PR metadata readback/preflight after PR creation.
- Closing Condition: PR Ready, merge, post-merge closeout for #230/#231/#232/#233/#234, and follow-up current pointer retire if required by gate.

## Covered Issues

- #230 FR: generate real-page write-precheck records.
- #231 generates Xiaohongshu draft write-precheck result.
- #232 generates BOSS greeting write-precheck result.
- #233 records risk, approval request, cancellation, and expiry states.
- #234 enforces `submitted=false` and preserves no-submit evidence.

## Explicitly Not Covered

- App UI issues #238-#247.
- Harbor/Lode code changes.
- Real account access, Cookie/profile import, live production page operation, browser launch/attach, and any external visible site action.
- True submit/write execution, approval execution, post-submit reconciliation, hosted browser, marketplace, bulk collection, account cloud hosting, or risk-bypass claims.

## Ownership Constraints

- Write ownership is limited to Core runtime helper/self-check/export files and CORE-231 Loom carriers.
- Shared `.loom/status/current.md` must remain `no_active_item`; CORE-231 is retained through item-specific Work Item/progress/spec carriers.
- No subagent output is unintegrated; no parallel lane may write the same Core runtime helper files or shared Loom carriers while this PR is active.
- GitHub issue/PR closeout, PR body, review artifacts, merge, and milestone closure remain owned by the main controller thread.

## Associated Artifacts

- packages/core/src/real-site-write-preview.ts
- packages/core/src/real-site-write-preview-self-check.ts
- packages/core/src/index.ts
- packages/core/src/self-check.ts
- packages/core/src/result-envelope.ts
- packages/core/src/task-submission.ts
- packages/core/src/harbor-admission.ts
- packages/core/src/run-record-store.ts
- packages/core/src/result-query.ts
- packages/core/src/run-query.ts
- packages/schemas/fixtures/real-site-*-write-preview-run-record.fixture.json
- packages/conformance/src/real-site-write-preview-fixtures.ts
- .loom/status/current.md
- .loom/progress/CORE-231.md
- .loom/specs/CORE-231
