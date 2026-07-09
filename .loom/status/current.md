# Current Status

## Derived Fact Chain View

- Item ID: CORE-248
- Goal: Correct the Core #248 terminal read-only result/evidence refs slice so Harbor evidence refs are only recorded after the runtime API positively confirms each requested ref.
- Scope: Core/WebEnvoy only. POST `/tasks` may complete a read-only run to a terminal refs-only result only when Harbor returns valid same-origin scene refs and each evidence lookup confirms the exact requested ref with an available access state. Query endpoints must expose run/result/evidence/session refs without raw browser material. Ownership is limited to Core runtime task-chain code, focused API self-checks, and CORE-248 carriers.
- Execution Path: work/core-248-evidence-ref-validation
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-248.md
- Review Entry: .loom/reviews/CORE-248.json
- Validation Entry: pnpm exec tsc -p packages/core/tsconfig.json --noEmit; pnpm exec tsc -p packages/api-server/tsconfig.json --noEmit; pnpm --filter @webenvoy/api-server test; pnpm --filter @webenvoy/core-runtime test; pnpm typecheck; git diff --check; loom fact-chain --target . --json; loom suite validate/carrier/evidence --target . --item CORE-248 --json
- Closing Condition: PR ready, merge, post-merge closeout for the corrective Core #248 evidence-ref validation slice, with App E2E left open until App consumes the API.
- Current Checkpoint: build
- Current Stop: Corrective implementation is integrated in the worktree: `verifyEvidenceRefs` now requires each Harbor evidence lookup response to match the requested `evidence_ref` and report `access_state: available`, with self-check coverage for invalid scene URLs plus malformed and mismatched evidence lookup responses failing closed without copied `evidence_refs`.
- Next Step: Create PR for Core #248, run current-head review and merge gates, then keep Core #243/App #265 open for App-driven live E2E.
- Blockers: None recorded.
- Latest Validation Summary: 2026-07-09T08:04Z UTC: `pnpm install --frozen-lockfile`, `pnpm exec tsc -p packages/core/tsconfig.json --noEmit`, `pnpm exec tsc -p packages/api-server/tsconfig.json --noEmit`, `pnpm --filter @webenvoy/core-runtime test`, `pnpm --filter @webenvoy/api-server test`, `pnpm typecheck`, `git diff --check`, `loom fact-chain --target . --json`, `loom suite carrier validate --target . --item CORE-248 --json`, `loom suite evidence validate --target . --item CORE-248 --json`, `loom suite validate --target . --item CORE-248 --json`, and `loom build --target . --item CORE-248 --build-evidence .loom/specs/CORE-248/build-evidence.json --json` passed. API self-check now covers invalid scene URL staying admitted/non-terminal, malformed and mismatched Harbor evidence lookup responses returning `evidence_unavailable`, failed run status, and no copied `evidence_refs`. Subagent implementation output was integrated and verified by the main controller, then the main controller added invalid scene URL coverage. No App/Harbor/Lode code changed and no real browser/account/profile/Cookie/production page action occurred.
- Recovery Boundary: Revert this corrective branch. No App/Harbor/Lode code changes, real account/profile/Cookie/production page access, submit, publish, send, save, hosted browser, marketplace, bulk collection, or risk-bypass action may occur in this batch. App E2E remains blocked until App submits through this API and user authorizes any real account/profile/production page action.
- Current Lane: Core #248 corrective evidence-ref validation.

## Runtime Evidence

- Run Entry: packages/api-server/src/runtime-task-submit-self-check.ts
- Logs Entry: not_applicable
- Diagnostics Entry: packages/core/src/runtime-task-chain.ts
- Verification Entry: .loom/progress/CORE-248.md
- Lane Entry: .loom/specs/CORE-248/plan.md

## Sources

- Static Truth: .loom/work-items/CORE-248.md
- Dynamic Truth: .loom/progress/CORE-248.md
- Locator Truth: .loom/bootstrap/init-result.json
- Fact Chain CLI: loom fact-chain --target . --json
