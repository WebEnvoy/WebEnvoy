# CORE-203 Plan

## Phases

### Phase 1 - Fixture records

- Add Xiaohongshu draft and BOSS greeting write-preview Run Record fixtures.
- Add page_changed, user_cancelled, and expired terminal state fixtures.

### Phase 2 - Conformance consumption

- Add a conformance helper that seeds the fixtures into a file-backed Run Record store.
- Assert no-submit guard, action risk, approval state, preview_result.submitted=false, result/failure query behavior, and no forbidden private field keys.

### Phase 3 - Documentation and carriers

- Update schema/conformance README summaries.
- Add CORE-203 Work Item, progress, suite, evidence, consistency, task-carrier, and status carriers.

### Phase 4 - PR readiness

- Run targeted Core/schema/conformance/typecheck/diff/Loom checks.
- Commit, push, create PR, read back PR body/head/branch, then run metadata preflight.

## Validation

- `pnpm --filter @webenvoy/core-runtime test`
- `pnpm --filter @webenvoy/api-server test`
- `pnpm --filter @webenvoy/schemas test`
- `pnpm conformance`
- `pnpm typecheck`
- `git diff --check`
- `loom fact-chain --target . --json`
- `loom verify --target . --json`
- `loom suite validate --target . --item CORE-203 --json`
- `loom suite carrier validate --target . --item CORE-203 --json`
- `loom suite evidence validate --target . --item CORE-203 --json`
- `loom build --target . --item CORE-203 --build-evidence .loom/specs/CORE-203/build-evidence.json --json`
- `loom pr metadata-preflight --body-file <rendered> --compare-body-file <readback>`

## Scenario Validation Mapping

- Scenario S-001 -> validation: automated by `pnpm --filter @webenvoy/schemas test` and `pnpm conformance`; validates Xiaohongshu and BOSS write-preview Run Record fixtures include site-specific capability/package/resource refs.
- Scenario S-002 -> validation: automated by `pnpm conformance`; validates action_request, risk classification, no-submit guard, and approval_request state.
- Scenario S-003 -> validation: automated by `pnpm conformance`; validates result query preview_result.state=available, expected_change, evidence refs, and submitted=false.
- Scenario S-004 -> validation: automated by `pnpm conformance`; validates page_changed failure reason, cancelled result outcome, expired approval summary, and expired result payload state.
