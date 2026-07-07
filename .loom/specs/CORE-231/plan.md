# CORE-231 Plan

## Implementation Goal

Reuse existing task submission, Lode admission, Harbor write-precheck admission, Run Record store, result envelope, result query, failure query, and approval query code. Add only the missing real-site write-precheck generation helper and targeted self-check coverage.

## Phases

### Phase 1

- Objective: Add real-site write-precheck generation helper.
- Deliverable: `real-site-write-preview.ts` accepts a write-precheck task submission plus Lode/Harbor refs-only facts, records action request/no-submit guard, and completes preview/cancel/expired states.
- Exit condition: core-runtime self-check covers Xiaohongshu, BOSS, page_changed, user_cancelled, approval expired, and `submitted=false`.

### Phase 2

- Objective: Preserve downstream queryability and no-submit evidence.
- Deliverable: exports and self-check assertions prove `getRunResult`, `getRunFailureReason`, and `getApprovalCancellationSummary` consume generated records.
- Exit condition: core-runtime, schema, conformance, typecheck, and diff checks pass.

### Phase 3

- Objective: PR, review, merge, and closeout.
- Deliverable: item-specific Loom carriers, validation evidence, commit, push, PR body, metadata readback, review artifacts, hosted checks, merge, issue closeout, milestone close, and current pointer retire if required.
- Exit condition: #230/#231/#232/#233/#234 are closed with post-merge evidence.

## Validation

- `pnpm --filter @webenvoy/core-runtime test`
- `pnpm --filter @webenvoy/schemas test`
- `pnpm --filter @webenvoy/conformance test`
- `pnpm conformance`
- `pnpm typecheck`
- `git diff --check`
- `loom fact-chain --target . --json`
- `loom verify --target . --json`
- `loom suite validate --target . --item CORE-231 --json`
- `loom suite carrier validate --target . --item CORE-231 --json`
- `loom suite evidence validate --target . --item CORE-231 --json`
- `loom build --target . --item CORE-231 --build-evidence .loom/specs/CORE-231/build-evidence.json --json`
- PR metadata readback/preflight after PR creation.

## Constraints

- No new dependencies, browser attach, live site access, true write, App UI, Harbor/Lode code, hosted browser, marketplace, bulk collection, or account cloud hosting.
- Core stores refs, risk state, approval/cancel/expired status, preview result, evidence refs, and no-submit facts only.

## Ready For Review

- [x] Initial core-runtime validation passed locally.
- [ ] Full local validation passed on current head.
- [ ] Final Loom/suite checks passed on current head.
- [ ] PR metadata readback matches CORE-231 branch/head/repository and issue coverage.
