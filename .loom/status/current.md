# Current Status

## Derived Fact Chain View

- Item ID: CORE-270
- Goal: Drive Xiaohongshu note-detail reads from Core-persisted Harbor-minted opaque search refs and record bounded result/evidence facts.
- Scope: Ownership remains in Core for XHS detail intent admission, opaque-ref provenance/lifecycle, Lode detail consumption, Harbor dispatch, Run Record refs, focused regressions, and item-specific carriers.
- Execution Path: work/core-270-xhs-detail
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-270.md
- Review Entry: .loom/reviews/CORE-270.json
- Validation Entry: targeted Core/API checks; full typecheck/test/lint; diff and Loom checks
- Closing Condition: Ready PR for #270 with current-head review and hosted checks; live issue closeout remains post-merge packaged App E2E.
- Current Checkpoint: review
- Current Stop: Product head `ec3a698fcb65fddf7ca2f00ebe7df9267a877a25` passed targeted/full validation and independent semantic review with no blocking findings.
- Next Step: Commit current-head carriers, push, create the CORE-270 PR, and consume hosted checks. Keep #270 open for packaged App live closeout.
- Blockers: None
- Latest Validation Summary: 2026-07-12T13:32Z at product head `ec3a698fcb65fddf7ca2f00ebe7df9267a877a25`: Core/API targeted typechecks and tests, full `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `git diff --check` passed. Independent review returned ALLOW after validating atomic search-target publication, opaque-ref binding, reserve/release/commit lifecycle, failure cleanup, and zero Harbor detail dispatch for rejected inputs.
- Recovery Boundary: Revert only CORE-270 code and carriers. Do not modify App, Harbor, Lode, BOSS production admission, or external runtime state.
- Current Lane: CORE-270 XHS opaque-ref detail execution.

## Runtime Evidence

- Run Entry: no production run in implementation; merged packaged App XHS search-to-detail E2E required for closeout
- Logs Entry: targeted and full pnpm validation at product head `ec3a698fcb65fddf7ca2f00ebe7df9267a877a25`
- Diagnostics Entry: packages/core/src/runtime-task-chain.ts; packages/api-server/src/runtime-task-submit-self-check.ts
- Verification Entry: .loom/specs/CORE-270/evidence-map.md
- Lane Entry: .loom/specs/CORE-270/plan.md

## Sources

- Static Truth: .loom/work-items/CORE-270.md
- Dynamic Truth: .loom/progress/CORE-270.md
- Locator Truth: .loom/bootstrap/init-result.json
- Fact Chain CLI: loom fact-chain --target . --json
