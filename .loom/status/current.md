# Current Status

## Derived Fact Chain View

- Item ID: CORE-227
- Goal: Consume Harbor's real BOSS `boss_job_search` read operation and accept only operation-specific, refs-only public results bound to the pinned Lode contract.
- Scope: BOSS query/city/page/limit API parsing, query/city dispatch, exact public-summary validation, Lode pin validation, session/control/challenge failure handling, source/evidence ref validation, focused/process self-checks, and CORE-227 carriers.
- Execution Path: work/core-227-boss-search-real-read
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-227.md
- Review Entry: .loom/reviews/CORE-227.json
- Validation Entry: focused Core/API typecheck and tests; full pnpm typecheck/test/lint; git diff checks; Loom suite/fact-chain/build checks
- Closing Condition: Ready PR covers #227 without merge or issue closure.
- Current Checkpoint: pre-review
- Current Stop: Product implementation committed at `921390c`; carrier head `6ea5ba2`; focused and full local validation plus independent semantic review passed.
- Next Step: Record the current-head spec and implementation reviews, then rerun the hosted merge gate.
- Blockers: None. Loom host issue binding reports stale dependency signals for already-merged PR numbers #240/#251; this is classified as a tool/host metadata surface issue and does not alter product scope.
- Latest Validation Summary: At product head `921390c` and carrier head `6ea5ba2`, focused Core/API typecheck/test/build, canonical BOSS target_ref/harbor.url parser and process-boundary tests, standalone runtime submit/process self-checks, full `pnpm typecheck`, `pnpm test`, `pnpm lint`, `git diff --check`, and Loom fact-chain/suite/carrier/evidence validation passed.
- Recovery Boundary: Revert only CORE-227-owned code/carrier changes. Do not change App/Harbor/Lode, access a live account, perform writes, or persist sensitive/raw material.
- Current Lane: CORE-227 BOSS job-search real read-only consumer.

## Runtime Evidence

- Run Entry: local_contract_process_validation
- Logs Entry: focused and full pnpm/Loom command output
- Diagnostics Entry: packages/core/src/runtime-task-chain.ts; packages/api-server/src/runtime-task-submit-self-check.ts
- Verification Entry: .loom/specs/CORE-227/build-evidence.json
- Lane Entry: .loom/specs/CORE-227/plan.md

## Sources

- Static Truth: .loom/work-items/CORE-227.md
- Dynamic Truth: .loom/progress/CORE-227.md
- Locator Truth: .loom/bootstrap/init-result.json
- Fact Chain CLI: loom fact-chain --target . --json
