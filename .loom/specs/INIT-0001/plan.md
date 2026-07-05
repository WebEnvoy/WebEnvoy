# Plan

## Implementation Goal

- Deliver a carrier-only bootstrap repair for INIT-0001 so Core Stage 5 capability task-intent PRs can attach to a consumable Loom fact chain.
- Defer all product behavior and Stage 5 admission/run/result implementation details to downstream real Work Item PRs.

## Phases

### Phase 1

- Objective: Replace placeholder spec and plan text with explicit bootstrap carrier scope and suite path decision.
- Deliverable: `.loom/specs/INIT-0001/spec.md` and `.loom/specs/INIT-0001/plan.md`
- Exit condition: `loom suite validate --target . --item INIT-0001 --json` passes.

### Phase 2

- Objective: Bind review artifacts to the current bootstrap branch and make hosted gate consume the repair.
- Deliverable: `.loom/reviews/INIT-0001.json`, `.loom/reviews/INIT-0001.spec.json`, and PR metadata readback.
- Exit condition: hosted `loom-pr-merge-gate` passes for Core bootstrap PR #159.

## Constraints

- Architectural or governance constraints: INIT-0001 remains bootstrap-only and must not carry Core admission/run/result semantics.
- Workspace / rollout constraints: This branch only supports Stage 5 first-batch dependency setup and does not enter Stage 6.
- Purity or scope constraints: No credential, runtime profile, raw evidence, run truth, result truth, or admission contract mutation may be introduced here.

## Validation

- Automated checks: `loom suite validate --target . --item INIT-0001 --json`, `loom suite evidence validate --target . --item INIT-0001 --json`, `loom suite carrier validate --target . --item INIT-0001 --json`, `loom fact-chain --target . --json`, `loom verify --target . --json`, `git diff --check`.
- Manual checks: PR body metadata readback for PR #159.
- Runtime evidence: No runtime evidence is produced by this carrier-only repair.
- Behavior evidence: Hosted Loom check consumes the bootstrap carrier.
- Story scenario to evidence mapping: Downstream real Work Item PRs carry Stage 5 scenarios; INIT-0001 only unblocks carrier consumption.
- Fresh verification evidence: `.loom/progress/INIT-0001.md`
- Execution ledger plan locator: `.loom/progress/INIT-0001.md`
- Execution ledger validation evidence locator: `.loom/progress/INIT-0001.md`

## Test Strategy

- TDD or test-first expectation: Not used for this carrier-only repair.
- Regression coverage to add or preserve: Preserve existing repo checks outside this bootstrap-only PR.
- Cases that are intentionally not automated: Capability task intent behavior is intentionally validated in downstream Core implementation PRs.
- How failing tests or equivalent checks will be introduced before implementation: Hosted gate failure log from PR #159 is the failing check that drives this repair.
- How passing tests or equivalent checks will be captured as test evidence: Command outputs are recorded in `.loom/progress/INIT-0001.md` and GitHub hosted run readback.
- How User Story acceptance scenarios map to tests, checks, manual validation, or scoped N/A evidence: Downstream real Work Item PRs map Stage 5 scenarios; this bootstrap repair is checked by carrier and hosted gate validation only.

## Subagent Output Integration

- Owned outputs: Main thread owns all shared `.loom/` carrier edits for this PR.
- Integration owner: Main thread.
- Required evidence from each subagent: No subagent owns bootstrap carrier writes.
- Review or reconciliation needed before merge-ready: Hosted gate and local carrier validation must consume the same PR head.
- Handoff notes locator: `.loom/progress/INIT-0001.md`

## Dependencies

- Blocking inputs: Current PR #159 head SHA and hosted gate log.
- Required coordination: Downstream App/Lode/Core/Harbor PRs must wait for bootstrap carrier consumption before merge.
- Rollback boundary: Revert this bootstrap branch carrier commit only.

## Ready For Implementation

- [x] Spec is stable enough to implement.
- [x] Scope and non-goals are clear.
- [x] Story business semantics remain downstream and are not carried by INIT-0001.
- [x] Validation path is defined.
- [x] Bootstrap carrier evidence maps to hosted gate validation.
- [x] Risks and dependencies are explicit.
