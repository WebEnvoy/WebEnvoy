# Current Status

## Derived Fact Chain View

- Item ID: CORE-267
- Goal: Drive Harbor's allowlisted real read-operation endpoint and persist only validated public result/evidence refs in Core Run Records.
- Scope: Core API task input, Lode runtime-consumption allowlist resolution, Harbor read-operation invocation, terminal failure mapping, refs-only result projection, focused self-checks, and CORE-267 Loom carriers. Ownership is limited to the Core repository paths declared below.
- Execution Path: work/core-267-harbor-read-operation
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-267.md
- Review Entry: .loom/reviews/CORE-267.json
- Validation Entry: pnpm --filter @webenvoy/core-runtime typecheck; pnpm --filter @webenvoy/api-server typecheck; pnpm --filter @webenvoy/core-runtime test; pnpm --filter @webenvoy/api-server test; pnpm --filter @webenvoy/api-server build; node packages/api-server/dist/runtime-task-submit-self-check.js; node packages/api-server/dist/runtime-process-self-check.js; pnpm typecheck; pnpm test; pnpm lint; git diff --check; Loom suite/fact-chain/build checks
- Closing Condition: Implementation PR merged and post-merge contract evidence recorded; #267 remains open until an authorized App-driven live operation on the merged runtime produces valid identity/session/run/result/evidence refs.
- Current Checkpoint: merge
- Current Stop: Implementation and independent semantic review are complete. Allowlisted tasks can succeed only from a Lode-pinned, session-bound Harbor completed operation; unavailable and indeterminate outcomes fail closed without snapshot-success fallback. P0/P1/P2 findings are resolved. A P3 advisory remains to move duplicated trust-boundary parsing and exact contract fixtures into a focused module when a shared schema is available.
- Next Step: Run hosted checks against the review-bound PR head and merge only after all required gates pass. Keep #267 open pending merged-runtime App live evidence.
- Blockers: None
- Latest Validation Summary: 2026-07-11 UTC current worktree passed focused Core/API typecheck, tests, API build/self-check/process-self-check, root `pnpm typecheck`, `pnpm test`, `pnpm lint`, `git diff --check`, and `loom fact-chain`. Independent review found no remaining P0/P1/P2 issues after the `unknown_outcome` HTTP status fix. Evidence is contract/mock validation only; no live site completion is claimed.
- Recovery Boundary: Revert branch `work/core-267-harbor-read-operation`; no App/Harbor/Lode mutation, automatic login, sensitive material access, submit/publish/send, bulk collection, hosted browser, account cloud hosting, or risk bypass is permitted.
- Current Lane: Core #267 Harbor allowlisted read-operation consumption.

## Runtime Evidence

- Run Entry: contract_smoke_passed_live_e2e_pending
- Logs Entry: .loom/progress/CORE-267.md
- Diagnostics Entry: packages/core/src/runtime-task-chain.ts; packages/core/src/lode-admission.ts; packages/api-server/src/server.ts
- Verification Entry: .loom/progress/CORE-267.md
- Lane Entry: .loom/specs/CORE-267/plan.md

## Sources

- Static Truth: .loom/work-items/CORE-267.md
- Dynamic Truth: .loom/progress/CORE-267.md
- Locator Truth: .loom/bootstrap/init-result.json
- Fact Chain CLI: loom fact-chain --target . --json
